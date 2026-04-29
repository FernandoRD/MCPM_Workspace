/**
 * Helpers de comunicação com os providers de sync.
 * Extraídos aqui para serem reutilizados tanto pela página de Sync quanto
 * pelo hook de sincronização automática.
 */
import { invoke } from "@tauri-apps/api/core";
import { AppSettings } from "@/types";
import i18n from "@/lib/i18n";

/**
 * Envia o payload para o provider configurado.
 * Retorna o gistId recém-criado se o Gist foi criado nesta chamada (GitHub Gist apenas).
 */
export async function pushToProvider(
  sync: AppSettings["sync"],
  payload: string
): Promise<string | undefined> {
  switch (sync.provider) {
    case "githubGist": {
      if (!sync.gist?.token) throw new Error(i18n.t("sync.errors.githubTokenMissing"));
      const returnedId = await invoke<string>("sync_gist_push", {
        token: sync.gist.token,
        gistId: sync.gist.gistId ?? null,
        payloadJson: payload,
      });
      // Só propaga o ID se foi criado agora (não existia antes)
      return !sync.gist.gistId ? returnedId : undefined;
    }
    case "s3": {
      const s3 = sync.s3;
      if (!s3) throw new Error(i18n.t("sync.errors.s3Missing"));
      await invoke("sync_s3_push", {
        endpoint: s3.endpoint ?? "",
        bucket: s3.bucket,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        payloadJson: payload,
      });
      return undefined;
    }
    case "webdav": {
      const wdav = sync.webdav;
      if (!wdav) throw new Error(i18n.t("sync.errors.webdavMissing"));
      await invoke("sync_webdav_push", {
        url: wdav.url,
        username: wdav.username,
        password: wdav.password,
        path: wdav.path || "vault.json",
        payloadJson: payload,
      });
      return undefined;
    }
    case "custom": {
      if (!sync.custom?.url) throw new Error(i18n.t("sync.errors.customUrlMissing"));
      await invoke("sync_custom_push", {
        url: sync.custom.url,
        payloadJson: payload,
      });
      return undefined;
    }
    default:
      throw new Error(i18n.t("sync.errors.providerMissing"));
  }
}

export async function pullFromProvider(sync: AppSettings["sync"]): Promise<string> {
  switch (sync.provider) {
    case "githubGist": {
      if (!sync.gist?.token) throw new Error(i18n.t("sync.errors.githubTokenMissing"));
      if (!sync.gist?.gistId)
        throw new Error(i18n.t("sync.errors.gistIdMissing"));
      return invoke<string>("sync_gist_pull", {
        token: sync.gist.token,
        gistId: sync.gist.gistId,
      });
    }
    case "s3": {
      const s3 = sync.s3;
      if (!s3) throw new Error(i18n.t("sync.errors.s3Missing"));
      return invoke<string>("sync_s3_pull", {
        endpoint: s3.endpoint ?? "",
        bucket: s3.bucket,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
      });
    }
    case "webdav": {
      const wdav = sync.webdav;
      if (!wdav) throw new Error(i18n.t("sync.errors.webdavMissing"));
      return invoke<string>("sync_webdav_pull", {
        url: wdav.url,
        username: wdav.username,
        password: wdav.password,
        path: wdav.path || "vault.json",
      });
    }
    case "custom": {
      if (!sync.custom?.url) throw new Error(i18n.t("sync.errors.customUrlMissing"));
      return invoke<string>("sync_custom_pull", { url: sync.custom.url });
    }
    default:
      throw new Error(i18n.t("sync.errors.providerMissing"));
  }
}
