// Support team roster. Used by the Team tab to:
//   1. Show bandwidth (count of Pylon tickets assigned to each person).
//   2. Render the "Currently working on" table and Team Calendar grid.
//
// `pylonEmail` should match the email Pylon stores on `issue.assignee.email`.
// If you don't know it yet, leave as null — the row still renders with 0
// bandwidth and a "Pylon user ID pending" note.

export type TeamMember = {
  id: string; // stable slug used as a key in localStorage / API responses
  name: string;
  initials: string;
  // The Pylon assignee email. Null = unknown yet (won't match any ticket).
  pylonEmail: string | null;
  // Tailwind bg class for the avatar circle + bandwidth bar.
  // Pick from a distinct palette so people are easy to tell apart at a glance.
  colorClass: string;
};

export const TEAM: TeamMember[] = [
  {
    id: "marc-underwood",
    name: "Marc Underwood",
    initials: "MU",
    pylonEmail: "marc@chefrobotics.ai",
    colorClass: "bg-orange-500",
  },
  {
    id: "daniela-guerra",
    name: "Daniela Guerra",
    initials: "DG",
    pylonEmail: "daniela@chefrobotics.ai",
    colorClass: "bg-emerald-500",
  },
  {
    id: "edward-hillman",
    name: "Edward Hillman",
    initials: "EH",
    pylonEmail: "edward@chefrobotics.ai",
    colorClass: "bg-purple-500",
  },
  {
    id: "sakshi-desai",
    name: "Sakshi Desai",
    initials: "SD",
    pylonEmail: "sakshi@chefrobotics.ai",
    colorClass: "bg-blue-500",
  },
  {
    id: "steven-garcia",
    name: "Steven Garcia",
    initials: "SG",
    pylonEmail: "steven@chefrobotics.ai",
    colorClass: "bg-pink-500",
  },
  {
    id: "fredy",
    name: "Fredy",
    initials: "FR",
    pylonEmail: "fredy@chefrobotics.ai",
    colorClass: "bg-cyan-500",
  },
];
