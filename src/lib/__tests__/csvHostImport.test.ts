import { describe, expect, it } from "vitest";
import {
  CSV_HOST_IMPORT_HEADERS,
  CsvHostImportFatalError,
  buildCsvHostImportPlan,
  buildCsvHostTemplate,
  parseCsvHostImport,
} from "@/lib/csvHostImport";
import { makeHost } from "./fixtures";

const HEADER_ROW = CSV_HOST_IMPORT_HEADERS.join(",");

function csvRow(values: Partial<Record<string, string>>): string {
  return CSV_HOST_IMPORT_HEADERS.map((header) => values[header] ?? "").join(",");
}

describe("buildCsvHostTemplate", () => {
  it("gera apenas o cabeçalho por padrão", () => {
    const template = buildCsvHostTemplate();
    expect(template).toBe(HEADER_ROW);
  });

  it("gera exemplos válidos quando solicitado", () => {
    const template = buildCsvHostTemplate(true);
    const preview = parseCsvHostImport(template, []);

    expect(preview.counts.totalRows).toBe(3);
    expect(preview.counts.invalidRows).toBe(0);
    expect(preview.counts.newRows).toBe(3);
  });
});

describe("parseCsvHostImport", () => {
  it("lança erro fatal quando o CSV está vazio", () => {
    expect(() => parseCsvHostImport("", [])).toThrowError(CsvHostImportFatalError);
    expect(() => parseCsvHostImport("", [])).toThrowError(
      expect.objectContaining({ code: "missingHeaderRow" })
    );
  });

  it("lança erro fatal listando cabeçalhos obrigatórios ausentes", () => {
    try {
      parseCsvHostImport("label,host\nX,1.1.1.1", []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CsvHostImportFatalError);
      expect((error as CsvHostImportFatalError).code).toBe("missingRequiredHeaders");
      expect((error as CsvHostImportFatalError).details).toEqual(["protocol"]);
    }
  });

  it("aceita BOM no primeiro cabeçalho", () => {
    const csv = `\uFEFF${HEADER_ROW}\n${csvRow({ label: "A", protocol: "ssh", host: "h" })}`;
    const preview = parseCsvHostImport(csv, []);

    expect(preview.counts.validRows).toBe(1);
  });

  it("ignora linhas em branco", () => {
    const csv = `${HEADER_ROW}\n${csvRow({ label: "A", protocol: "ssh", host: "h" })}\n,,,,,,,,,,,,,\n`;
    const preview = parseCsvHostImport(csv, []);

    expect(preview.counts.totalRows).toBe(1);
  });

  it("aplica porta padrão por protocolo", () => {
    const csv = [
      HEADER_ROW,
      csvRow({ label: "S", protocol: "ssh", host: "h1" }),
      csvRow({ label: "T", protocol: "telnet", host: "h2" }),
      csvRow({ label: "R", protocol: "rdp", host: "h3" }),
      csvRow({ label: "V", protocol: "vnc", host: "h4" }),
    ].join("\n");

    const preview = parseCsvHostImport(csv, []);
    const ports = preview.rows.map((row) => row.draft?.port);

    expect(ports).toEqual([22, 23, 3389, 5900]);
  });

  it("usa 'agent' como authMethod padrão para ssh e 'password' para os demais", () => {
    const csv = [
      HEADER_ROW,
      csvRow({ label: "S", protocol: "ssh", host: "h1" }),
      csvRow({ label: "R", protocol: "rdp", host: "h2" }),
    ].join("\n");

    const preview = parseCsvHostImport(csv, []);

    expect(preview.rows[0].draft?.authMethod).toBe("agent");
    expect(preview.rows[1].draft?.authMethod).toBe("password");
  });

  it("faz parse de tags separadas por ; ou , com dedupe", () => {
    const row = csvRow({ label: "A", protocol: "ssh", host: "h", tags: '"linux; prod ;linux,web"' });
    const csv = `${HEADER_ROW}\n${row}`;
    const preview = parseCsvHostImport(csv, []);

    expect(preview.rows[0].draft?.tags).toEqual(["linux", "prod", "web"]);
  });

  it("suporta campos entre aspas com vírgulas e aspas escapadas", () => {
    // notas com vírgula e aspas precisam ir na coluna correta; monta manualmente:
    const row = CSV_HOST_IMPORT_HEADERS.map((header) => {
      if (header === "label") return "A";
      if (header === "protocol") return "ssh";
      if (header === "host") return "h";
      if (header === "notes") return '"nota, com ""aspas"""';
      return "";
    }).join(",");
    const preview = parseCsvHostImport(`${HEADER_ROW}\n${row}`, []);

    expect(preview.rows[0].draft?.notes).toBe('nota, com "aspas"');
    expect(preview.rows[0].status).toBe("new");
  });

  it("marca erros de validação por linha", () => {
    const row = csvRow({
      label: "",
      protocol: "ftp",
      host: "",
      port: "70000",
      authMethod: "oauth",
      keepAliveInterval: "-5",
      connectionTimeout: "abc",
      sshCompatPreset: "antigo",
    });
    const preview = parseCsvHostImport(`${HEADER_ROW}\n${row}`, []);
    const codes = preview.rows[0].errors.map((error) => error.code);

    expect(preview.rows[0].status).toBe("invalid");
    expect(preview.rows[0].draft).toBeNull();
    expect(codes).toEqual([
      "missingLabel",
      "missingHost",
      "invalidProtocol",
      "invalidPort",
      "invalidAuthMethod",
      "invalidKeepAliveInterval",
      "invalidConnectionTimeout",
      "invalidSshCompatPreset",
    ]);
  });

  it("detecta id e identidade duplicados dentro do arquivo", () => {
    const csv = [
      HEADER_ROW,
      csvRow({ id: "x", label: "A", protocol: "ssh", host: "h", username: "u" }),
      csvRow({ id: "x", label: "B", protocol: "ssh", host: "h", username: "u" }),
    ].join("\n");

    const preview = parseCsvHostImport(csv, []);
    const codes = preview.rows[1].errors.map((error) => error.code);

    expect(codes).toContain("duplicateIdInFile");
    expect(codes).toContain("duplicateIdentityInFile");
    expect(preview.counts.invalidRows).toBe(1);
  });

  it("ignora sshCompatPreset para protocolos não-ssh", () => {
    const csv = `${HEADER_ROW}\n${csvRow({ label: "R", protocol: "rdp", host: "h", sshCompatPreset: "legacy" })}`;
    const preview = parseCsvHostImport(csv, []);

    expect(preview.rows[0].status).toBe("new");
    expect(preview.rows[0].draft?.sshCompat).toBeUndefined();
  });

  it("faz match por id e por identidade (protocolo/host/porta/usuário)", () => {
    const existing = [
      makeHost({ id: "id-1", host: "10.0.0.1", port: 22, username: "root" }),
      makeHost({ id: "id-2", host: "10.0.0.2", port: 2222, username: "admin" }),
    ];
    const csv = [
      HEADER_ROW,
      csvRow({ id: "id-1", label: "Por Id", protocol: "ssh", host: "outro", port: "22" }),
      csvRow({ label: "Por Identidade", protocol: "ssh", host: "10.0.0.2", port: "2222", username: "ADMIN" }),
      csvRow({ label: "Novo", protocol: "ssh", host: "10.0.0.3" }),
    ].join("\n");

    const preview = parseCsvHostImport(csv, existing);

    expect(preview.rows[0].status).toBe("matched");
    expect(preview.rows[0].existingHostId).toBe("id-1");
    expect(preview.rows[1].status).toBe("matched");
    expect(preview.rows[1].existingHostId).toBe("id-2");
    expect(preview.rows[2].status).toBe("new");
    expect(preview.counts).toEqual({
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
      newRows: 1,
      matchedRows: 2,
    });
  });
});

describe("buildCsvHostImportPlan", () => {
  const csv = `${HEADER_ROW}\n${csvRow({ label: "Novo", protocol: "ssh", host: "10.0.0.9", tags: "web" })}`;

  it("cria hosts novos com id gerado e timestamps", () => {
    const preview = parseCsvHostImport(csv, []);
    const plan = buildCsvHostImportPlan(preview, [], "add");

    expect(plan.createdCount).toBe(1);
    expect(plan.nextHosts).toHaveLength(1);
    expect(plan.nextHosts[0].id).toBeTruthy();
    expect(plan.nextHosts[0].label).toBe("Novo");
    expect(plan.nextHosts[0].tags).toEqual(["web"]);
    expect(plan.nextHosts[0].createdAt).toBeTruthy();
  });

  it("modo 'add' pula hosts existentes", () => {
    const existing = makeHost({ id: "id-1", host: "10.0.0.9", port: 22 });
    const preview = parseCsvHostImport(csv, [existing]);
    const plan = buildCsvHostImportPlan(preview, [existing], "add");

    expect(plan.skippedCount).toBe(1);
    expect(plan.updatedCount).toBe(0);
    expect(plan.nextHosts[0].label).toBe("Host 1");
  });

  it("modo 'merge' atualiza hosts existentes preservando campos não importados", () => {
    const existing = makeHost({
      id: "id-1",
      host: "10.0.0.9",
      port: 22,
      credentialId: "cred-9",
      notes: "nota antiga",
    });
    const csvMerge = `${HEADER_ROW}\n${csvRow({ label: "Renomeado", protocol: "ssh", host: "10.0.0.9" })}`;
    const preview = parseCsvHostImport(csvMerge, [existing]);
    const plan = buildCsvHostImportPlan(preview, [existing], "merge");

    expect(plan.updatedCount).toBe(1);
    expect(plan.nextHosts[0].label).toBe("Renomeado");
    expect(plan.nextHosts[0].credentialId).toBe("cred-9");
    expect(plan.nextHosts[0].id).toBe("id-1");
    expect(plan.nextHosts[0].notes).toBeUndefined();
  });

  it("conta linhas inválidas sem importá-las", () => {
    const invalidCsv = `${HEADER_ROW}\n${csvRow({ label: "", protocol: "ssh", host: "h" })}`;
    const preview = parseCsvHostImport(invalidCsv, []);
    const plan = buildCsvHostImportPlan(preview, [], "add");

    expect(plan.invalidCount).toBe(1);
    expect(plan.nextHosts).toHaveLength(0);
  });

  it("não muta o array de hosts atual", () => {
    const existing = [makeHost({ id: "id-1", host: "10.0.0.9" })];
    const preview = parseCsvHostImport(csv, existing);
    buildCsvHostImportPlan(preview, existing, "merge");

    expect(existing[0].label).toBe("Host 1");
  });
});
