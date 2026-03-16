import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default Leaflet marker assets when bundled by Vite.
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export function DiversionMap({ coordinates, severity }: { coordinates: [number, number][]; severity: 'low' | 'medium' | 'high' }) {
  const color = severity === 'high' ? '#ef4444' : severity === 'medium' ? '#f59e0b' : '#3b82f6';

  return (
    <MapContainer
      center={coordinates[0]}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Polyline positions={coordinates} color={color} weight={5} opacity={0.7} />
      <Marker position={coordinates[0]}>
        <Popup>Start Omleiding</Popup>
      </Marker>
      <Marker position={coordinates[coordinates.length - 1]}>
        <Popup>Eind Omleiding</Popup>
      </Marker>
    </MapContainer>
  );
}
