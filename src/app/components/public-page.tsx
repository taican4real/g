import type { ReactNode } from "react";
import { PublicHeader } from "./public-header";

export function PublicPage({ children }: { children: ReactNode }) {
  return <><PublicHeader /><main className="public-main">{children}</main></>;
}
