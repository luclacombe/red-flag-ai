import { redirect } from "next/navigation";

export default function SignupRedirect() {
  redirect("/login?mode=signup");
}
