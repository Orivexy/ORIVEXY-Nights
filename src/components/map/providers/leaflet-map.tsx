"use client";

import { useEffect, useMemo, useRef } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MarkerClusters } from "../clusters";
import { BARCELONA_BOUNDS, MIN_ZOOM, type MapMarker, type MapProviderProps } from "../types";
import { clusterHtml, isPlace, markerHtml } from "../marker-html";

/**
 * MapProvider: Leaflet renderer (raster tiles from CARTO / Mapbox / MapTiler,
 * see MapConfig). Markers and clusters are ORIVEXY NIGHTS's own HTML, so another
 * renderer can reproduce them exactly.
 */

export default function LeafletMap({
  config, center, zoom = 13, markers, selectedId, onSelect, onMapClick, interactive = true, wheelZoom, cluster = false, zoomControls = false, user, recenterKey = 0, className, satellite = false, fitMarkers,
}: MapProviderProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const userLayer = useRef<L.LayerGroup | null>(null);
  const leaflet = useRef<typeof L | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const onSelectRef = useRef(onSelect);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onMapClickRef.current = onMapClick;
  });

  // The selected marker is always drawn on its own, never hidden in a cluster.
  const clusters = useMemo(() => (cluster ? new MarkerClusters(markers.filter((m) => m.id !== selectedId)) : null), [cluster, markers, selectedId]);
  const renderRef = useRef<() => void>(() => {});

  useEffect(() => {
    renderRef.current = () => {
      const Lf = leaflet.current;
      const m = map.current;
      if (!Lf || !m || !layer.current) return;
      layer.current.clearLayers();
      const addMarker = (mk: MapMarker) => {
        const selected = mk.id === selectedId;
        const place = isPlace(mk.variant);
        const size = place ? 26 : 30;
        const icon = Lf.divIcon({ html: markerHtml(mk, selected), className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
        const marker = Lf.marker([mk.lat, mk.lng], { icon, zIndexOffset: selected ? 1000 : mk.live ? 200 : place ? 0 : 100, keyboard: interactive, title: mk.label, riseOnHover: true });
        if (interactive)
          marker.on("click", (e) => {
            Lf.DomEvent.stopPropagation(e);
            onSelectRef.current?.(mk.id);
          });
        marker.addTo(layer.current!);
      };

      if (!clusters) {
        markers.forEach(addMarker);
        return;
      }
      const b = m.getBounds().pad(0.3);
      for (const item of clusters.items([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom())) {
        if (item.type === "marker") {
          addMarker(item.marker);
          continue;
        }
        const { size, html } = clusterHtml(item.count, item.live);
        const cm = Lf.marker([item.lat, item.lng], { icon: Lf.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: 500, title: `${item.count} lugares` });
        cm.on("click", (e) => {
          Lf.DomEvent.stopPropagation(e);
          m.flyTo([item.lat, item.lng], Math.min(clusters.expansionZoom(item.id), config.maxZoom), { duration: 0.5 });
        });
        cm.addTo(layer.current!);
      }
      const sel = markers.find((x) => x.id === selectedId);
      if (sel) addMarker(sel);
    };
    renderRef.current();
  }, [clusters, markers, selectedId, interactive, config.maxZoom]);

  // Init once
  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((mod) => {
      const Lf = (mod.default ?? mod) as typeof L;
      if (disposed || !el.current || map.current) return;
      leaflet.current = Lf;
      const m = Lf.map(el.current, {
        center: [center.lat, center.lng],
        zoom,
        zoomControl: false,
        attributionControl: true,
        minZoom: MIN_ZOOM,
        maxBounds: [[BARCELONA_BOUNDS[0][1], BARCELONA_BOUNDS[0][0]], [BARCELONA_BOUNDS[1][1], BARCELONA_BOUNDS[1][0]]],
        maxBoundsViscosity: 1,
        dragging: interactive,
        scrollWheelZoom: interactive && wheelZoom !== false,
        doubleClickZoom: interactive,
        touchZoom: interactive,
        keyboard: interactive,
        zoomSnap: 0.25,
        zoomDelta: 0.75,
        wheelPxPerZoomLevel: 90,
        inertiaDeceleration: 2600,
      });
      if (interactive && zoomControls) Lf.control.zoom({ position: "bottomright" }).addTo(m);
      tiles.current = baseTiles(Lf, satellite).addTo(m);
      if (interactive) {
        m.on("click", (e: L.LeafletMouseEvent) => {
          if (onMapClickRef.current) onMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
          else onSelectRef.current?.(null);
        });
        m.on("moveend zoomend", () => renderRef.current());
      }
      layer.current = Lf.layerGroup().addTo(m);
      userLayer.current = Lf.layerGroup().addTo(m);
      map.current = m;
      if (fitMarkers && markers.length) {
        const size = m.getSize();
        const [l, r, t, b] = [fitMarkers.left ?? 24, fitMarkers.right ?? 24, fitMarkers.top ?? 24, fitMarkers.bottom ?? 24];
        const fits = l + r < size.x - 80 && t + b < size.y - 80;
        m.fitBounds(Lf.latLngBounds(markers.map((mk) => [mk.lat, mk.lng] as [number, number])), {
          paddingTopLeft: fits ? [l, t] : [24, 24],
          paddingBottomRight: fits ? [r, b] : [24, 24],
          maxZoom: fitMarkers.maxZoom ?? 15,
          animate: false,
        });
      }
      renderRef.current();
      drawUser();
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function baseTiles(Lf: typeof L, sat: boolean) {
    return sat && config.satelliteUrl
      ? Lf.tileLayer(config.satelliteUrl, { attribution: config.satelliteAttribution, maxZoom: config.maxZoom, maxNativeZoom: 19, keepBuffer: 4, updateWhenZooming: false })
      : Lf.tileLayer(config.tileUrl, { attribution: config.attribution, maxZoom: config.maxZoom, subdomains: "abcd", detectRetina: true, keepBuffer: 4, updateWhenZooming: false });
  }
  useEffect(() => {
    const Lf = leaflet.current;
    const m = map.current;
    if (!Lf || !m) return;
    tiles.current?.remove();
    tiles.current = baseTiles(Lf, satellite).addTo(m);
    tiles.current.bringToBack();
  }, [satellite]); // eslint-disable-line react-hooks/exhaustive-deps

  function drawUser() {
    const Lf = leaflet.current;
    if (!Lf || !userLayer.current) return;
    userLayer.current.clearLayers();
    if (user) {
      Lf.marker([user.lat, user.lng], { icon: Lf.divIcon({ html: '<div class="nx-user"><span></span></div>', className: "", iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: false, keyboard: false }).addTo(userLayer.current);
    }
  }
  useEffect(drawUser, [user]);  

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.flyTo([center.lat, center.lng], Math.max(m.getZoom(), zoom), { duration: 0.6, easeLinearity: 0.2 });
  }, [center.lat, center.lng, recenterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={className} role="application" aria-label="Mapa" />;
}
