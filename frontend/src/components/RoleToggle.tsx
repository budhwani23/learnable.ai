import { GraduationCap, Presentation } from "lucide-react";
import type { Role } from "@/lib/types";
import { ROLE_COPY } from "@/lib/roles";

/** Two-option switch between the student and teacher sign-in / sign-up pages. */
export default function RoleToggle({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  const options: { value: Role; icon: typeof GraduationCap }[] = [
    { value: "student", icon: GraduationCap },
    { value: "teacher", icon: Presentation },
  ];
  return (
    <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-full bg-emerald-50 p-1 mb-6">
      {options.map(({ value, icon: Icon }) => {
        const active = role === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={[
              "flex items-center justify-center gap-2 rounded-full py-2 text-sm font-medium transition-colors",
              active ? "bg-white text-emerald-700 shadow-sm" : "text-gray-600 hover:text-emerald-700",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            I'm a {ROLE_COPY[value].label.toLowerCase()}
          </button>
        );
      })}
    </div>
  );
}
