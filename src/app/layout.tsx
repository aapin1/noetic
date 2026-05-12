import type { ReactNode } from "react";

export const metadata = {
  title: "MNEME Backend",
  description: "MNEME backend API",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
