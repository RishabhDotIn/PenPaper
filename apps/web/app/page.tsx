import type { Metadata } from "next";
import { Launcher } from "@/components/Launcher";
import "./launcher.css";

export const metadata: Metadata = {
  title: "PenPaper",
  description: "A whiteboard that saves on your device and, if you want, to Google Drive.",
};

/** Opens the last notepad, or asks which one when this device has none. */
export default function Home() {
  return <Launcher />;
}
