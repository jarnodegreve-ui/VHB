import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
// Marker-assets uit het leaflet-pakket zelf importeren → Vite bundelt ze lokaal
// (gehashte asset-URL's), i.p.v. ze van cdnjs te halen (geen externe request,
// geen IP-lek naar een CDN). De OSM-tiles blijven wel extern; die horen
// inherent bij een kaart.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix default Leaflet marker assets when bundled by Vite.
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export function DiversionMap({ coordinates }: { coordinates: [number, number][] }) {
  // Eén neutrale merkkleur (oker) voor de omleiding-markering.
  const color = '#E8A33D';

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
