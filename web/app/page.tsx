"use client"

import { useEffect, useState } from "react"

// Entity pins data: each entity is mapped to a location
interface EntityPin {
  longitude: number
  latitude: number
  entityKey: string
  label: string
}

const ENTITY_PINS: EntityPin[] = [
  {
    longitude: -74.006,
    latitude: 40.7128,
    entityKey: "0x6cc9153ec65a9ce3f38612aacc3e42b515c873447cd7ded61d50827e42c837da",
    label: "New York"
  },
  {
    longitude: 139.6503,
    latitude: 35.6762,
    entityKey: "0xa6d88ab5e0431e14d4c128732f284c1b01264f3aea6da6e6795be8ecdb046324",
    label: "Tokyo"
  },
  {
    longitude: 151.2093,
    latitude: -33.8688,
    entityKey: "0x41b7c352cd68e134e17f632a5bfdd115f76f358b283c5d2052b15153b08122f5",
    label: "Sydney"
  },
  {
    longitude: 103.8198,
    latitude: 1.3521,
    entityKey: "0x64ee0155d327175a26299902458545a997760e604f656b17160beb020eedb9b9",
    label: "Singapore"
  },
  {
    longitude: -46.6333,
    latitude: -23.5505,
    entityKey: "0x56541957f79b8fc396fa570cb5e5fcd16eb2c4f27e4852aae27f37f1d21d3624",
    label: "São Paulo"
  },
  {
    longitude: 18.4241,
    latitude: -33.9249,
    entityKey: "0xa7888b205abb280d97da8fd48055e49d1b15f3e7e9b41fa4aa964fbb6790dbaa",
    label: "Cape Town"
  },
]

// Convert lat/lng to SVG coordinates
// SVG viewBox: 0 0 1138 640
// World map typically: longitude -180 to 180, latitude -60 to 80
function latLngToSVG(lng: number, lat: number): [number, number] {
  const svgWidth = 1138
  const svgHeight = 640
  
  // Normalize longitude (-180 to 180) to x (0 to svgWidth)
  const x = ((lng + 180) / 360) * svgWidth
  
  // Normalize latitude (-60 to 80) to y (0 to svgHeight)
  // Note: SVG y increases downward, so we invert
  const minLat = -60
  const maxLat = 80
  const normalizedLat = (lat - minLat) / (maxLat - minLat)
  const y = svgHeight - (normalizedLat * svgHeight)
  
  return [x, y]
}

export default function HomePage() {
  const [svgContent, setSvgContent] = useState<string>("")
  const [isDark, setIsDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem("theme")
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches

    if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
      setIsDark(true)
      document.documentElement.classList.add("dark")
    } else {
      setIsDark(false)
      document.documentElement.classList.remove("dark")
    }
  }, [])

  useEffect(() => {
    const loadSVG = async () => {
      try {
        const svgFile = isDark ? "/map-dark.svg" : "/map.svg"
        const response = await fetch(svgFile)
        const svgText = await response.text()
        setSvgContent(svgText)
      } catch (error) {
        console.error("Failed to load SVG:", error)
      }
    }

    if (mounted) {
      loadSVG()
    }
  }, [isDark, mounted])

  useEffect(() => {
    if (svgContent) {
      const timer = setTimeout(() => {
        const mapContainer = document.getElementById("map-svg")
        if (!mapContainer) return

        const svgElement = mapContainer.querySelector("svg")
        if (!svgElement) return

        // Make SVG responsive and centered
        svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet")
        svgElement.style.width = "100%"
        svgElement.style.height = "100%"
        svgElement.style.maxWidth = "100%"
        svgElement.style.maxHeight = "100vh"

        // Remove existing pins if any
        const existingPins = svgElement.querySelectorAll(".entity-pin")
        existingPins.forEach((pin) => pin.remove())

        // Add entity pins
        const pinColor = "#45CC2D"
        const pinShadowColor = "#45CC2D"
        
        ENTITY_PINS.forEach((entityPin) => {
          const [x, y] = latLngToSVG(entityPin.longitude, entityPin.latitude)
          
          // Create pin group
          const pinGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
          pinGroup.setAttribute("class", "entity-pin")
          pinGroup.setAttribute("transform", `translate(${x}, ${y})`)
          pinGroup.setAttribute("style", "cursor: pointer;")
          
          // Create clickable area (larger invisible circle for better UX)
          const clickableArea = document.createElementNS("http://www.w3.org/2000/svg", "circle")
          clickableArea.setAttribute("cx", "0")
          clickableArea.setAttribute("cy", "0")
          clickableArea.setAttribute("r", "20")
          clickableArea.setAttribute("fill", "transparent")
          clickableArea.setAttribute("style", "cursor: pointer;")
          clickableArea.addEventListener("click", () => {
            const explorerUrl = `https://explorer.mendoza.hoodi.arkiv.network/entity/${entityPin.entityKey}?tab=data`
            window.open(explorerUrl, "_blank")
          })
          
          // Pin shadow (slightly offset)
          const shadow = document.createElementNS("http://www.w3.org/2000/svg", "circle")
          shadow.setAttribute("cx", "2")
          shadow.setAttribute("cy", "2")
          shadow.setAttribute("r", "8")
          shadow.setAttribute("fill", pinShadowColor)
          shadow.setAttribute("opacity", "0.3")
          
          // Pin outer circle
          const outerCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
          outerCircle.setAttribute("cx", "0")
          outerCircle.setAttribute("cy", "0")
          outerCircle.setAttribute("r", "8")
          outerCircle.setAttribute("fill", pinColor)
          outerCircle.setAttribute("opacity", "0.8")
          outerCircle.setAttribute("style", "animation: pinBlink 2s ease-in-out infinite; cursor: pointer;")
          outerCircle.addEventListener("click", () => {
            const explorerUrl = `https://explorer.mendoza.hoodi.arkiv.network/entity/${entityPin.entityKey}?tab=data`
            window.open(explorerUrl, "_blank")
          })
          
          // Pin inner dot
          const innerCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
          innerCircle.setAttribute("cx", "0")
          innerCircle.setAttribute("cy", "0")
          innerCircle.setAttribute("r", "4")
          innerCircle.setAttribute("fill", "#ffffff")
          innerCircle.setAttribute("style", "cursor: pointer;")
          innerCircle.addEventListener("click", () => {
            const explorerUrl = `https://explorer.mendoza.hoodi.arkiv.network/entity/${entityPin.entityKey}?tab=data`
            window.open(explorerUrl, "_blank")
          })
          
          // Pin pulse ring
          const pulseRing = document.createElementNS("http://www.w3.org/2000/svg", "circle")
          pulseRing.setAttribute("cx", "0")
          pulseRing.setAttribute("cy", "0")
          pulseRing.setAttribute("r", "8")
          pulseRing.setAttribute("fill", "none")
          pulseRing.setAttribute("stroke", pinColor)
          pulseRing.setAttribute("stroke-width", "2")
          pulseRing.setAttribute("opacity", "0.6")
          pulseRing.setAttribute("style", "animation: pinPulse 2s ease-out infinite; cursor: pointer;")
          pulseRing.addEventListener("click", () => {
            const explorerUrl = `https://explorer.mendoza.hoodi.arkiv.network/entity/${entityPin.entityKey}?tab=data`
            window.open(explorerUrl, "_blank")
          })
          
          pinGroup.appendChild(clickableArea)
          pinGroup.appendChild(shadow)
          pinGroup.appendChild(pulseRing)
          pinGroup.appendChild(outerCircle)
          pinGroup.appendChild(innerCircle)
          
          svgElement.appendChild(pinGroup)
        })

        // Add animations for pins
        const style = document.createElement("style")
        style.id = "map-animations"
        style.textContent = `
          @keyframes pinBlink {
            0%, 100% { 
              opacity: 0.8;
              transform: scale(1);
            }
            50% { 
              opacity: 1;
              transform: scale(1.1);
            }
          }
          
          @keyframes pinPulse {
            0% {
              opacity: 0.6;
              transform: scale(1);
            }
            100% {
              opacity: 0;
              transform: scale(2.5);
            }
          }
          
          .entity-pin:hover circle[fill="#45CC2D"] {
            opacity: 1 !important;
            transform: scale(1.2);
            transition: all 0.2s ease;
          }
          
          .entity-pin:hover circle[stroke="#45CC2D"] {
            opacity: 0.8 !important;
          }
        `
        
        // Remove old style if exists
        const oldStyle = document.getElementById("map-animations")
        if (oldStyle) oldStyle.remove()
        
        document.head.appendChild(style)

        // Apply glimmer to existing rects
        const rects = document.querySelectorAll("#map-svg rect")
        console.log(`[v0] Found ${rects.length} rect elements`)

        rects.forEach((rect, index) => {
          const duration = Math.random() * 1.5 + 0.5
          const delay = Math.random() * 1

          rect.setAttribute(
            "style",
            `
            animation: glimmer ${duration}s ease-in-out ${delay}s infinite alternate;
          `,
          )
        })

        // Add glimmer animation if not exists
        const glimmerStyle = document.getElementById("glimmer-animation")
        if (!glimmerStyle) {
          const glimmerAnim = document.createElement("style")
          glimmerAnim.id = "glimmer-animation"
          glimmerAnim.textContent = `
            @keyframes glimmer {
              0% { opacity: 1; }
              100% { opacity: 0.1; }
            }
          `
          document.head.appendChild(glimmerAnim)
        }
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [svgContent, isDark])

  const toggleTheme = () => {
    console.log("[v0] Toggling theme, current isDark:", isDark)

    const newIsDark = !isDark
    setIsDark(newIsDark)

    if (newIsDark) {
      document.documentElement.classList.add("dark")
      localStorage.setItem("theme", "dark")
    } else {
      document.documentElement.classList.remove("dark")
      localStorage.setItem("theme", "light")
    }

    console.log("[v0] Theme toggled to:", newIsDark ? "dark" : "light")
  }

  if (!mounted) {
    return (
      <div
        className="min-h-screen w-full overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="flex justify-center items-center w-full h-full">
          <div
            className="bg-gray-200 animate-pulse rounded-lg"
            style={{ width: "100%", maxWidth: "1138px", aspectRatio: "1138/640" }}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen w-full py-24 px-8 overflow-hidden flex items-center justify-center" 
    >
      <div className="relative flex justify-center items-center w-full h-full p-8">
        {svgContent ? (
          <>
            <div
              id="map-svg"
              className="w-full h-full max-w-full max-h-screen flex items-center justify-center"
              style={{ aspectRatio: "1138/640" }}
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
            <div
              className="absolute bottom-4 right-4 pointer-events-none select-none"
              style={{
                color: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)",
                fontSize: "24px",
                fontWeight: 300,
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              OpenArkiv
            </div>
          </>
        ) : (
          <div
            className="bg-gray-200 animate-pulse rounded-lg"
            style={{ width: "100%", maxWidth: "1138px", aspectRatio: "1138/640" }}
          />
        )}
      </div>
    </div>
  )
}
