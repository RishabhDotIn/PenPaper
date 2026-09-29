import type { Metadata } from "next";
import { Library } from "@/components/Library";
import "./library.css";

export const metadata: Metadata = {
  title: "PenPaper — all notepads",
  description: "Every notepad on this device, and the ones you keep in Google Drive.",
};

/** The shelf is the front door: pick a notepad, or start a new one. */
export default function Home() {
  return <Library />;
}
