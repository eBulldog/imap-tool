import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { defaultServerForm, type ServerForm } from "../types";

export type ViewerPreset = {
  mailboxPathA: string;
  mailboxPathB: string;
  limit: number;
};

type Ctx = {
  serverA: ServerForm;
  serverB: ServerForm;
  setServerA: (f: ServerForm | ((p: ServerForm) => ServerForm)) => void;
  setServerB: (f: ServerForm | ((p: ServerForm) => ServerForm)) => void;
  viewerPreset: ViewerPreset | null;
  setViewerPreset: (p: ViewerPreset | null) => void;
};

const ServersContext = createContext<Ctx | null>(null);

export function ServersProvider({ children }: { children: ReactNode }) {
  const [serverA, setServerA] = useState<ServerForm>(() => defaultServerForm());
  const [serverB, setServerB] = useState<ServerForm>(() => defaultServerForm());
  const [viewerPreset, setViewerPreset] = useState<ViewerPreset | null>(null);

  const value = useMemo(
    () => ({
      serverA,
      serverB,
      setServerA,
      setServerB,
      viewerPreset,
      setViewerPreset,
    }),
    [serverA, serverB, viewerPreset]
  );

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}

export function useServers() {
  const c = useContext(ServersContext);
  if (!c) throw new Error("useServers outside ServersProvider");
  return c;
}
