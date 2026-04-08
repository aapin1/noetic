import type { ReactNode } from "react";

export const metadata = {
  title: "NOETIC Backend",
  description: "NOETIC backend API",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
