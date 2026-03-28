export const rollDie = (sides) => Math.floor(Math.random() * sides) + 1

export const rollStandard = (count, sides, modifier = 0) => {
  const rolls = Array.from({ length: count }, () => rollDie(sides))
  const sum = rolls.reduce((a, b) => a + b, 0) + modifier
  const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : ''
  return `${sum} ⟵ [${rolls.join(', ')}]${modStr ? ` ${modStr}` : ''} ${count}d${sides}${modStr}`
}

export const rollNamed = (sides) => {
  if (sides !== 6) return 'Named dice only supports d6n'

  const roll = rollDie(6)
  const dieFace = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][roll - 1]
  const results = {
    1: '🗡️',
    2: '🗡️🗡️',
    3: '🗡️🗡️🗡️',
    4: '⚖️',
    5: '💀',
    6: '💀💀'
  }

  return `${dieFace} [${results[roll]}] d${sides}n`
}

export const parseRepeater = (text) => {
  const match = text.match(/^(\d+)#(.+)$/)
  if (!match) return null

  const count = parseInt(match[1])
  const expr = match[2]
  return Array.from({ length: count }, () => parseDiceCommand(expr)).join('\n')
}

export const parseNamed = (text) => {
  const match = text.match(/^d(\d+)n$/i)
  if (!match) return null
  return rollNamed(parseInt(match[1]))
}

export const parseStandard = (text) => {
  const match = text.match(/^(\d*)d(\d+)([+-]\d+)?$/i)
  if (!match) return null

  const count = match[1] ? parseInt(match[1]) : 1
  const sides = parseInt(match[2])
  const modifier = match[3] ? parseInt(match[3]) : 0
  return rollStandard(count, sides, modifier)
}

export const parseDiceCommand = (text) => {
  const input = text.trim()
  return parseRepeater(input) ?? parseNamed(input) ?? parseStandard(input)
}
