import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * High-resolution population density raster from WorldPop 100m
 * (ArcGIS ImageServer). We transform XYZ tile coords to EPSG:3857
 * bbox and request a 256×256 PNG via exportImage.
 *
 * Activates only at street-level zoom (visible whenever mounted).
 */

const TILE_SIZE = 256;
const ORIGIN = 20037508.342789244; // EPSG:3857 half-extent

function tile2bbox(x: number, y: number, z: number): string {
  const res = (ORIGIN * 2) / Math.pow(2, z);
  const minX = -ORIGIN + x * TILE_SIZE * res / TILE_SIZE * (Math.pow(2, z) * TILE_SIZE) / (Math.pow(2, z) * TILE_SIZE);
  // Simpler: tile width in EPSG:3857 meters
  const tileSize3857 = (ORIGIN * 2) / Math.pow(2, z);
  const xmin = -ORIGIN + x * tileSize3857;
  const xmax = xmin + tileSize3857;
  const ymax = ORIGIN - y * tileSize3857;
  const ymin = ymax - tileSize3857;
  return `${xmin},${ymin},${xmax},${ymax}`;
}

const renderingRule = encodeURIComponent(JSON.stringify({
  rasterFunction: 'Stretch',
  rasterFunctionArguments: { StretchType: 6, Min: 0, Max: 200, Gamma: [0.7] },
}));

const WorldPopTileLayer = ({ opacity = 0.65 }: { opacity?: number }) => {
  const map = useMap();

  useEffect(() => {
    const WorldPopLayer = L.TileLayer.extend({
      getTileUrl(coords: { x: number; y: number; z: number }) {
        const bbox = tile2bbox(coords.x, coords.y, coords.z);
        return `https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_100m/ImageServer/exportImage` +
          `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${TILE_SIZE},${TILE_SIZE}` +
          `&format=png32&pixelType=F32&renderingRule=${renderingRule}&f=image`;
      },
    });

    const layer = new (WorldPopLayer as any)('', {
      opacity,
      maxZoom: 19,
      minZoom: 11,
      attribution: '&copy; WorldPop 100m',
      tileSize: TILE_SIZE,
      crossOrigin: true,
    });
    layer.addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, opacity]);

  return null;
};

export default WorldPopTileLayer;
