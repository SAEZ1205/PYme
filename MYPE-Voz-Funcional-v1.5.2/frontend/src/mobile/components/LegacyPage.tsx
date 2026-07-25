import type { ReactNode } from "react";
export function LegacyPage({children,className=""}:{children:ReactNode;className?:string}){return <div className={`mobile-legacy-page ${className}`}>{children}</div>}
