import { useState } from 'react'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

// State centroids [longitude, latitude]
const STATE_CENTROIDS = {
  AL: [-86.8, 32.7],  AK: [-153.4, 64.2], AZ: [-111.6, 34.3], AR: [-92.2, 34.8],
  CA: [-119.7, 36.8], CO: [-105.6, 38.9], CT: [-72.7, 41.6],  DE: [-75.5, 38.9],
  FL: [-81.7, 27.8],  GA: [-83.2, 32.7],  HI: [-156.5, 20.8], ID: [-114.7, 44.0],
  IL: [-89.2, 40.1],  IN: [-86.1, 40.2],  IA: [-93.6, 41.9],  KS: [-98.4, 38.5],
  KY: [-85.3, 37.5],  LA: [-91.8, 31.1],  ME: [-69.4, 44.7],  MD: [-76.6, 39.0],
  MA: [-71.5, 42.4],  MI: [-84.6, 44.1],  MN: [-93.1, 46.4],  MS: [-89.7, 32.7],
  MO: [-92.4, 38.3],  MT: [-110.4, 46.8], NE: [-99.9, 41.4],  NV: [-117.1, 38.5],
  NH: [-71.6, 43.7],  NJ: [-74.3, 40.1],  NM: [-106.1, 34.4], NY: [-75.6, 42.9],
  NC: [-79.4, 35.5],  ND: [-100.3, 47.5], OH: [-82.8, 40.4],  OK: [-96.9, 35.6],
  OR: [-120.6, 43.9], PA: [-77.8, 40.9],  RI: [-71.5, 41.6],  SC: [-80.9, 33.8],
  SD: [-100.2, 44.4], TN: [-86.7, 35.7],  TX: [-97.6, 31.1],  UT: [-111.1, 39.4],
  VT: [-72.7, 44.1],  VA: [-79.0, 37.5],  WA: [-120.5, 47.4], WV: [-80.6, 38.6],
  WI: [-89.8, 44.3],  WY: [-107.6, 43.0],
}

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
  '#14b8a6', '#f43f5e', '#a855f7', '#22c55e', '#eab308',
]

export default function UsPropertyMap({ locations }) {
  const [tooltip, setTooltip] = useState(null)

  // Assign stable color to each unique tenant brand
  const brands = [...new Set(locations.map(l => l.tenant_brand_name).filter(Boolean))]
  const brandColor = {}
  brands.forEach((b, i) => { brandColor[b] = PALETTE[i % PALETTE.length] })

  // Group by state, then build markers with jitter for multiple properties per state
  const byState = {}
  locations.forEach(loc => {
    if (!byState[loc.state]) byState[loc.state] = []
    byState[loc.state].push(loc)
  })

  const markers = []
  Object.entries(byState).forEach(([state, props]) => {
    const center = STATE_CENTROIDS[state]
    if (!center) return
    props.forEach((p, i) => {
      const count = props.length
      const angle = count > 1 ? (i / count) * Math.PI * 2 : 0
      const radius = count > 1 ? 0.6 : 0
      markers.push({
        ...p,
        coords: [
          center[0] + Math.cos(angle) * radius,
          center[1] + Math.sin(angle) * radius,
        ],
      })
    })
  })

  return (
    <div className="relative">
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 900 }}
        style={{ width: '100%', height: 'auto' }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#f1f5f9"
                stroke="#cbd5e1"
                strokeWidth={0.5}
                style={{
                  default: { outline: 'none' },
                  hover:   { fill: '#e2e8f0', outline: 'none' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>

        {markers.map((m, i) => (
          <Marker
            key={i}
            coordinates={m.coords}
            onMouseEnter={() => setTooltip(m)}
            onMouseLeave={() => setTooltip(null)}
          >
            <circle
              r={6}
              fill={brandColor[m.tenant_brand_name] || '#64748b'}
              stroke="white"
              strokeWidth={1.5}
              opacity={0.9}
              style={{ cursor: 'pointer' }}
            />
          </Marker>
        ))}
      </ComposableMap>

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute top-4 left-4 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-sm pointer-events-none z-10 max-w-[220px]">
          {tooltip.tenant_brand_name && (
            <p className="font-semibold text-blue-700 text-xs mb-1">{tooltip.tenant_brand_name}</p>
          )}
          <p className="font-medium text-slate-800">{tooltip.address}</p>
          {(tooltip.city || tooltip.state) && (
            <p className="text-xs text-slate-500">{[tooltip.city, tooltip.state].filter(Boolean).join(', ')}</p>
          )}
        </div>
      )}

      {/* Legend */}
      {brands.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 px-2">
          {brands.map(brand => (
            <div key={brand} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: brandColor[brand] }}
              />
              <span className="text-xs text-slate-600">{brand}</span>
            </div>
          ))}
          {locations.some(l => !l.tenant_brand_name) && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-slate-400 shrink-0" />
              <span className="text-xs text-slate-500">No brand</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
