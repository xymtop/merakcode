const tones = ["jade", "teal", "sand", "rose"] as const

function tone(id: string) {
  const hash = [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) | 0, 0)
  return tones[Math.abs(hash) % tones.length]
}

function initials(name: string) {
  return [...name.trim()][0]?.toUpperCase() ?? "A"
}

export function AgentAvatar(props: { id: string; name: string; size?: "sm" | "lg" }) {
  return (
    <span class="agent-avatar" data-tone={tone(props.id)} data-size={props.size} aria-hidden="true">
      {initials(props.name)}
    </span>
  )
}
