//! Worker bloqueante da sessão RDP.
//!
//! O `ActiveStage` e o transporte bloqueante pertencem exclusivamente à thread
//! criada aqui. A UI recebe apenas notificações de regiões alteradas e lê o
//! framebuffer por meio de [`SharedDecodedImage`], o que impede que o event
//! loop fique preso em `read_pdu`.

use std::sync::{
    mpsc::{self, Receiver, Sender, TryRecvError},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use ironrdp::pdu::geometry::InclusiveRectangle;
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::session::{image::DecodedImage, ActiveStage};

use crate::mvp_runtime::{apply_active_stage_outputs, drain_active_stage, UpgradedFramed};

/// Framebuffer decodificado compartilhado entre o worker e o presenter.
///
/// O worker mantém o lock enquanto o IronRDP altera a imagem; o presenter deve
/// segurá-lo apenas durante a cópia/upload das regiões recebidas.
pub type SharedDecodedImage = Arc<Mutex<DecodedImage>>;

/// Configuração do orçamento de trabalho por iteração do worker.
#[derive(Debug, Clone, Copy)]
pub struct RdpWorkerConfig {
    /// Máximo de PDUs processadas em uma drenagem.
    pub max_frames_per_drain: usize,
    /// Tempo máximo gasto em uma drenagem antes de voltar a verificar comandos.
    pub max_drain_duration: Duration,
}

impl Default for RdpWorkerConfig {
    fn default() -> Self {
        Self {
            max_frames_per_drain: 16,
            max_drain_duration: Duration::from_millis(4),
        }
    }
}

/// Dados de uma atualização processada pelo worker.
#[derive(Debug, Clone, Default)]
pub struct RdpWorkerUpdate {
    /// Regiões do framebuffer alteradas desde a última notificação.
    pub dirty_regions: Vec<InclusiveRectangle>,
    /// Quantidade de PDUs recebidas e processadas nesta atualização.
    pub frames_processed: u64,
    /// Tempo acumulado bloqueado nas leituras de PDUs.
    pub pdu_read_duration: Duration,
    /// Tempo acumulado no processamento do `ActiveStage`.
    pub active_stage_process_duration: Duration,
    /// Tempo acumulado no processamento de entrada do cliente.
    pub input_process_duration: Duration,
    /// Tempo acumulado escrevendo respostas RDP geradas pelo processamento.
    pub response_write_duration: Duration,
}

impl RdpWorkerUpdate {
    fn has_work(&self) -> bool {
        self.frames_processed > 0
            || !self.dirty_regions.is_empty()
            || !self.input_process_duration.is_zero()
    }
}

/// Mensagens enviadas do worker para o event loop.
#[derive(Debug, Clone)]
pub enum RdpWorkerEvent {
    /// Uma ou mais PDUs/entradas foram processadas.
    Update(RdpWorkerUpdate),
    /// O worker encontrou um erro terminal.
    Error(String),
    /// O worker encerrou após o comando de desligamento ou fechamento do canal.
    Stopped,
}

enum WorkerCommand {
    Input(Vec<FastPathInputEvent>),
    Shutdown,
}

/// Handle da thread de rede RDP.
///
/// A leitura da conexão continua bloqueante, mas acontece fora da thread da UI.
/// O timeout de leitura configurado no `UpgradedFramed` limita a latência com
/// que comandos de entrada e encerramento são observados.
pub struct RdpWorker {
    image: SharedDecodedImage,
    command_tx: Sender<WorkerCommand>,
    updates_rx: Receiver<RdpWorkerEvent>,
    join_handle: Option<JoinHandle<()>>,
}

impl RdpWorker {
    /// Inicia uma thread dona do `ActiveStage` e do transporte RDP já conectado.
    pub fn start(
        active_stage: ActiveStage,
        framed: UpgradedFramed,
        image: DecodedImage,
    ) -> Result<Self> {
        Self::start_with_config(active_stage, framed, image, RdpWorkerConfig::default())
    }

    /// Variante de [`start`](Self::start) que permite ajustar o orçamento de drenagem.
    pub fn start_with_config(
        active_stage: ActiveStage,
        framed: UpgradedFramed,
        image: DecodedImage,
        config: RdpWorkerConfig,
    ) -> Result<Self> {
        anyhow::ensure!(
            config.max_frames_per_drain > 0,
            "max_frames_per_drain must be greater than zero"
        );
        anyhow::ensure!(
            !config.max_drain_duration.is_zero(),
            "max_drain_duration must be greater than zero"
        );

        let image = Arc::new(Mutex::new(image));
        let worker_image = Arc::clone(&image);
        let (command_tx, command_rx) = mpsc::channel();
        let (updates_tx, updates_rx) = mpsc::channel();
        let join_handle = thread::Builder::new()
            .name("rdp-network-worker".to_owned())
            .spawn(move || {
                run_worker(
                    active_stage,
                    framed,
                    worker_image,
                    command_rx,
                    updates_tx,
                    config,
                )
            })
            .context("start RDP network worker")?;

        Ok(Self {
            image,
            command_tx,
            updates_rx,
            join_handle: Some(join_handle),
        })
    }

    /// Retorna uma referência compartilhável do framebuffer decodificado.
    pub fn shared_image(&self) -> SharedDecodedImage {
        Arc::clone(&self.image)
    }

    /// Enfileira eventos Fast Path para envio pelo worker de rede.
    pub fn send_input(&self, events: Vec<FastPathInputEvent>) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        self.command_tx
            .send(WorkerCommand::Input(events))
            .map_err(|_| anyhow::anyhow!("RDP worker is no longer running"))
    }

    /// Drena notificações já disponíveis, sem bloquear o event loop.
    pub fn try_drain_updates(&self) -> Vec<RdpWorkerEvent> {
        self.updates_rx.try_iter().collect()
    }

    /// Solicita o encerramento gracioso e aguarda o término da thread.
    ///
    /// A espera é limitada na prática pelo timeout de leitura já configurado no
    /// transporte, salvo um bloqueio de I/O durante a escrita do shutdown.
    pub fn shutdown(&mut self) -> Result<()> {
        if self.join_handle.is_none() {
            return Ok(());
        }

        // A thread pode ter terminado por erro antes deste comando; isso não
        // impede o join, que é necessário para liberar os recursos com ordem.
        let _ = self.command_tx.send(WorkerCommand::Shutdown);
        if let Some(join_handle) = self.join_handle.take() {
            join_handle
                .join()
                .map_err(|_| anyhow::anyhow!("RDP worker thread panicked"))?;
        }
        Ok(())
    }
}

impl Drop for RdpWorker {
    fn drop(&mut self) {
        // Não bloqueie o event loop em Drop. `shutdown` é o caminho explícito
        // para enviar a solicitação graciosa e aguardar o término.
        let _ = self.command_tx.send(WorkerCommand::Shutdown);
    }
}

fn run_worker(
    mut active_stage: ActiveStage,
    mut framed: UpgradedFramed,
    image: SharedDecodedImage,
    command_rx: Receiver<WorkerCommand>,
    updates_tx: Sender<RdpWorkerEvent>,
    config: RdpWorkerConfig,
) {
    loop {
        let mut update = RdpWorkerUpdate::default();
        let mut shutdown_requested = false;
        let mut pending_input = Vec::new();

        loop {
            match command_rx.try_recv() {
                Ok(WorkerCommand::Input(events)) => pending_input.extend(events),
                Ok(WorkerCommand::Shutdown) => {
                    shutdown_requested = true;
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    shutdown_requested = true;
                    break;
                }
            }
        }

        if shutdown_requested {
            if let Err(error) = send_graceful_shutdown(&active_stage, &mut framed) {
                let _ = updates_tx.send(RdpWorkerEvent::Error(format!(
                    "send RDP graceful shutdown: {error:#}"
                )));
            }
            break;
        }

        if !pending_input.is_empty() {
            let input_started_at = Instant::now();
            let input_result = (|| -> Result<()> {
                let mut image = image
                    .lock()
                    .map_err(|_| anyhow::anyhow!("decoded image lock poisoned"))?;
                let outputs = active_stage
                    .process_fastpath_input(&mut image, &pending_input)
                    .context("process RDP input")?;
                if let Some(region) = apply_active_stage_outputs(&mut framed, outputs)? {
                    update.dirty_regions.push(region);
                }
                Ok(())
            })();
            update.input_process_duration += input_started_at.elapsed();

            if let Err(error) = input_result {
                let _ = updates_tx.send(RdpWorkerEvent::Error(format!(
                    "process RDP input: {error:#}"
                )));
                break;
            }
        }

        let drain_result = (|| -> Result<()> {
            let mut image = image
                .lock()
                .map_err(|_| anyhow::anyhow!("decoded image lock poisoned"))?;
            let summary = drain_active_stage(
                &mut active_stage,
                &mut framed,
                &mut image,
                config.max_frames_per_drain,
                config.max_drain_duration,
            )?;
            update.frames_processed += summary.frames_processed;
            update.pdu_read_duration += summary.pdu_read_duration;
            update.active_stage_process_duration += summary.active_stage_process_duration;
            update.response_write_duration += summary.response_write_duration;
            update.dirty_regions.extend(summary.dirty_regions);
            Ok(())
        })();

        // `drain_active_stage` holds the image lock while a blocking read is
        // pending. Hand the scheduler a chance to run the presenter before
        // attempting the next drain, so the UI can acquire the shared image
        // and upload the dirty regions it has just received.
        thread::yield_now();

        if let Err(error) = drain_result {
            let _ = updates_tx.send(RdpWorkerEvent::Error(format!(
                "drain RDP active stage: {error:#}"
            )));
            break;
        }

        if update.has_work() && updates_tx.send(RdpWorkerEvent::Update(update)).is_err() {
            // A UI saiu; o sender de comandos será descartado e esta thread não
            // deve continuar mantendo a conexão viva sem consumidor.
            break;
        }
    }

    let _ = updates_tx.send(RdpWorkerEvent::Stopped);
}

fn send_graceful_shutdown(active_stage: &ActiveStage, framed: &mut UpgradedFramed) -> Result<()> {
    let outputs = active_stage
        .graceful_shutdown()
        .map_err(|error| anyhow::anyhow!("create RDP graceful shutdown: {error:?}"))?;
    apply_active_stage_outputs(framed, outputs)?;
    Ok(())
}
