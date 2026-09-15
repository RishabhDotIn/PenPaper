import { redirect } from "next/navigation";

/** The offline board is the landing experience until boards have an index. */
export default function Home() {
  redirect("/b/local");
}
