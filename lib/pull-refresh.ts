export function pullDistance(
  dx: number,
  dy: number,
  scrollTop: number,
  touches = 1
) {
  if (touches !== 1 || scrollTop > 0 || dy <= 10 || Math.abs(dx) > dy) return 0
  return Math.min(96, dy * 0.45)
}
export const pullRefreshThreshold = 64
