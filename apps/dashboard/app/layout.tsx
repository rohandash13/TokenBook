import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Countersign · Spending authority", description: "Trace every payment. Grow agent authority with earned rules." };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
