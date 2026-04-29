import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet's broken default icon URLs in Vite bundled builds
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl:       markerIcon,
  shadowUrl:     markerShadow,
})

// Default center: geographic center of the contiguous US
const DEFAULT_CENTER = [39.5, -98.35]
const DEFAULT_ZOOM   = 4

export default function PortfolioMap({ properties }) {
  const navigate = useNavigate()
  const pinned   = (properties || []).filter(p => p.lat != null && p.lng != null)

  const center = pinned.length > 0
    ? [pinned.reduce((s, p) => s + p.lat, 0) / pinned.length,
       pinned.reduce((s, p) => s + p.lng, 0) / pinned.length]
    : DEFAULT_CENTER
  const zoom = pinned.length > 0 ? 5 : DEFAULT_ZOOM

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: 400, width: '100%' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pinned.map(p => (
        <Marker key={p.id} position={[p.lat, p.lng]}>
          <Popup>
            <div style={{ minWidth: 160 }}>
              <p style={{ fontWeight: 600, marginBottom: 2 }}>{p.address}</p>
              {(p.city || p.state) && (
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  {[p.city, p.state].filter(Boolean).join(', ')}
                </p>
              )}
              {p.tenant_brand_name && (
                <p style={{ fontSize: 12, color: '#1d4ed8', marginBottom: 6 }}>
                  {p.tenant_brand_name}
                </p>
              )}
              <button
                onClick={() => navigate(`/management/${p.id}`)}
                style={{
                  fontSize: 12, color: '#2563eb', background: 'none',
                  border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                }}
              >
                View property →
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
