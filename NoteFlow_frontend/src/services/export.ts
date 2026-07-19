import axios from 'axios'

export type ExportFormat = 'md' | 'pdf' | 'html' | 'docx' | 'png'

const getToken = (): string | null => {
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) {
      const { state } = JSON.parse(stored)
      return state?.token ?? null
    }
  } catch {
    // ignore
  }
  return null
}

export const exportNote = async (params: {
  content: string
  format: ExportFormat
  title: string
}): Promise<void> => {
  const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
  const token = getToken()

  const response = await axios.post(`${baseURL}/export`, params, {
    responseType: 'blob',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 60000,
  })

  const extMap: Record<ExportFormat, string> = {
    md:   '.md',
    pdf:  '.pdf',
    html: '.html',
    docx: '.docx',
    png:  '.png',
  }

  const blob = new Blob([response.data])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${params.title}${extMap[params.format]}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
