export function appHome(role: string) {
  return role === "driver" ? "/driver" : "/"
}
