import { create } from "zustand";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
}

interface UpdateStore {
  info: UpdateInfo | null;
  dismissed: boolean;
  setInfo: (info: UpdateInfo) => void;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  info: null,
  dismissed: false,
  setInfo: (info) => set({ info }),
  dismiss: () => set({ dismissed: true }),
}));
