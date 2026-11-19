export const invitationRoleLabels = {
  driver: "Водитель",
  dispatcher: "Диспетчер",
  accountant: "Бухгалтер",
  admin: "Администратор",
} as const

export type InvitationRole = keyof typeof invitationRoleLabels
