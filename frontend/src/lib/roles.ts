import type { Role } from "@/lib/types";

/** Read the role from a route param (/login/teacher) or ?role=, defaulting to student. */
export const parseRole = (value?: string | null): Role => (value === "teacher" ? "teacher" : "student");

export const ROLE_COPY: Record<Role, { label: string; signIn: string; signInBlurb: string; signUp: string; signUpBlurb: string }> = {
  student: {
    label: "Student",
    signIn: "Student sign in",
    signInBlurb: "Pick up your summaries, flashcards and quizzes, and open links from your teacher.",
    signUp: "Create a student account",
    signUpBlurb: "Turn lectures, PDFs and videos into study material in minutes.",
  },
  teacher: {
    label: "Teacher",
    signIn: "Teacher sign in",
    signInBlurb: "Create lessons, quizzes and explainer videos and share them with your classes.",
    signUp: "Create a teacher account",
    signUpBlurb: "Build class material and share it to Google Classroom, Moodle or Canvas.",
  },
};
