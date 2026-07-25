import type { ReactNode } from "react";
export function PageContainer({ children, className="" }: { children:ReactNode; className?:string }) {
  return <div className={`px-4 pt-4 pb-28 ${className}`}>{children}</div>;
}
