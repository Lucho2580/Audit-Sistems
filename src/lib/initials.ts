// Dos iniciales en mayúscula a partir de un nombre ("Jean Carlos Tariffe" -> "JC").
export function initialsOf(name: string): string {
  return name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
