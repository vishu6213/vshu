import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  vshuRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.vshuRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.vshuRendererRoot = root
  }
  return root
}
