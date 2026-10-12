const ARROW_CHARACTERS = /[\uF700-\uF703]/g;

export function cleanComposerInput(value: string, start: number, end = start) {
  return {
    text: value.replace(ARROW_CHARACTERS, ""),
    start: value.slice(0, start).replace(ARROW_CHARACTERS, "").length,
    end: value.slice(0, end).replace(ARROW_CHARACTERS, "").length,
  };
}

export function arrowAtInputBoundary(
  key: string,
  length: number,
  start: number,
  end: number,
): boolean {
  if (start !== end) return false;
  if (key === "ArrowLeft" || key === "ArrowUp") return start === 0;
  if (key === "ArrowRight" || key === "ArrowDown") return end === length;
  return false;
}
