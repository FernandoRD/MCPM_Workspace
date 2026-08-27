import { describe, expect, it } from "vitest";
import {
  buildGroupTree,
  collectAllGroupPaths,
  flattenGroupTree,
  getGroupLeafName,
  getGroupParentPath,
  isGroupInTree,
  joinGroupPath,
  normalizeGroupPath,
  renameGroupPath,
} from "@/lib/groups";

describe("group path helpers", () => {
  it("normaliza espaços, barras repetidas e valores vazios", () => {
    expect(normalizeGroupPath("  Produção / Linux // Web  ")).toBe("Produção/Linux/Web");
    expect(normalizeGroupPath(" /// ")).toBeUndefined();
    expect(normalizeGroupPath(null)).toBeUndefined();
  });

  it("resolve pai, folha e junção de caminhos", () => {
    expect(getGroupParentPath("Produção/Linux/Web")).toBe("Produção/Linux");
    expect(getGroupParentPath("Produção")).toBeNull();
    expect(getGroupLeafName("Produção/Linux/Web")).toBe("Web");
    expect(joinGroupPath(" Produção / Linux ", " Web ")).toBe("Produção/Linux/Web");
    expect(joinGroupPath(null, " Web ")).toBe("Web");
  });

  it("reconhece somente o próprio grupo e descendentes", () => {
    expect(isGroupInTree("Produção/Linux", "Produção")).toBe(true);
    expect(isGroupInTree("Produção", "Produção")).toBe(true);
    expect(isGroupInTree("Produção-Backup", "Produção")).toBe(false);
    expect(isGroupInTree(undefined, "Produção")).toBe(false);
  });

  it("renomeia o grupo e seus descendentes sem afetar prefixos parecidos", () => {
    expect(renameGroupPath("Produção/Linux/Web", "Produção/Linux", "Infra/Servidores")).toBe(
      "Infra/Servidores/Web"
    );
    expect(renameGroupPath("Produção/Linux", "Produção/Linux", "Infra")).toBe("Infra");
    expect(renameGroupPath("Produção/Linux-Old", "Produção/Linux", "Infra")).toBe(
      "Produção/Linux-Old"
    );
  });
});

describe("group tree", () => {
  it("inclui ancestrais implícitos, remove duplicatas e ordena", () => {
    expect(
      collectAllGroupPaths(["Produção/Linux/Web", " Produção / Linux ", "Desenvolvimento", null])
    ).toEqual(["Desenvolvimento", "Produção", "Produção/Linux", "Produção/Linux/Web"]);
  });

  it("constrói e achata a hierarquia preservando profundidade e pai", () => {
    const tree = buildGroupTree(["Produção/Linux/Web", "Produção/Windows", "Desenvolvimento"]);

    expect(tree.map((node) => node.path)).toEqual(["Desenvolvimento", "Produção"]);
    expect(tree[1].children.map((node) => node.path)).toEqual([
      "Produção/Linux",
      "Produção/Windows",
    ]);

    expect(flattenGroupTree(tree)).toEqual([
      {
        path: "Desenvolvimento",
        name: "Desenvolvimento",
        depth: 0,
        parentPath: null,
        hasChildren: false,
      },
      {
        path: "Produção",
        name: "Produção",
        depth: 0,
        parentPath: null,
        hasChildren: true,
      },
      {
        path: "Produção/Linux",
        name: "Linux",
        depth: 1,
        parentPath: "Produção",
        hasChildren: true,
      },
      {
        path: "Produção/Linux/Web",
        name: "Web",
        depth: 2,
        parentPath: "Produção/Linux",
        hasChildren: false,
      },
      {
        path: "Produção/Windows",
        name: "Windows",
        depth: 1,
        parentPath: "Produção",
        hasChildren: false,
      },
    ]);
  });
});
