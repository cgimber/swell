// Station picker: a satellite map shown in the plot's empty centre. Tapping
// the inset opens it to the full plot with every station; tapping a station
// selects it and closes the map again. Uses the global `L` (Leaflet, from
// index.html) and Esri World Imagery tiles.

const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const INSET_SPAN_DEG = 0.35; // longitude shown across the closed inset, enough to include the coast
const ANIM_MS = 350; // keep in step with the clip-path transition in styles.css

/**
 * wrap: the .plot-wrap element; it gets an `open` class while the map is open.
 * Returns { setSelected(id), layout({ R, r0 }) }.
 */
export function createStationMap(wrap, { stations, selected, onSelect, onOpen }) {
  const el = wrap.querySelector('.station-map');
  const insetBtn = wrap.querySelector('.map-inset-btn');
  const closeBtn = wrap.querySelector('.map-close');
  let current = selected;
  let open = false;
  let lastR = 0, lastR0 = 0;
  let insetZoom = 9;

  const map = L.map(el, {
    zoomControl: false,
    attributionControl: false, // the round map clips corner controls; credited in the footer
    zoomSnap: 0.25,
  });
  L.tileLayer(TILES, { maxZoom: 16 }).addTo(map);

  const markers = new Map(stations.map((s) => {
    const m = L.marker([s.lat, s.lon], {
      title: s.name,
      alt: s.name,
      icon: L.divIcon({ className: 'stn', html: '<span></span>', iconSize: [32, 32] }),
    }).addTo(map);
    const dir = s.label ?? 'right';
    const offset = { left: [-10, 0], right: [10, 0], top: [0, -10], bottom: [0, 10] }[dir];
    m.bindTooltip(s.name, { permanent: true, direction: dir, offset, className: 'stn-label' });
    m.on('click', () => {
      if (!open) return expand();
      if (s.id !== current) onSelect(s.id);
      collapse();
    });
    return [s.id, m];
  }));

  const station = (id) => stations.find((s) => s.id === id);
  const setInteractive = (on) => {
    for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']) {
      map[h][on ? 'enable' : 'disable']();
    }
  };
  const allBounds = () => L.latLngBounds(stations.map((s) => [s.lat, s.lon]));

  function markSelected() {
    for (const [id, m] of markers) {
      m.getElement()?.classList.toggle('selected', id === current);
    }
  }

  function expand() {
    open = true;
    wrap.classList.add('open');
    setInteractive(true);
    // the map is circular, so leave room for the corners the circle cuts off
    const pad = el.clientWidth * 0.25;
    map.flyToBounds(allBounds(), { padding: [pad, pad], duration: ANIM_MS / 1000 });
    markSelected();
    closeBtn.focus();
    onOpen?.();
  }

  function collapse() {
    open = false;
    wrap.classList.remove('open');
    setInteractive(false);
    const s = station(current);
    map.flyTo([s.lat, s.lon], insetZoom, { duration: ANIM_MS / 1000 });
    markSelected();
    insetBtn.focus();
  }

  insetBtn.addEventListener('click', expand);
  closeBtn.addEventListener('click', collapse);

  setInteractive(false);
  const s0 = station(current);
  map.setView([s0.lat, s0.lon], insetZoom, { animate: false });
  markSelected();

  return {
    setSelected(id) {
      current = id;
      markSelected();
      if (!open) {
        const s = station(id);
        map.setView([s.lat, s.lon], insetZoom, { animate: false });
      }
    },
    layout({ R, r0 }) {
      if (R === lastR && r0 === lastR0) return; // redraws without a resize keep the view
      lastR = R; lastR0 = r0;
      // web-mercator: 256·2^z px per 360° of longitude
      if (r0 > 0) insetZoom = Math.log2(((2 * r0) / INSET_SPAN_DEG) * (360 / 256));
      wrap.style.setProperty('--map-r', `${R}px`);
      wrap.style.setProperty('--inset-r', `${Math.max(0, r0 - 4)}px`);
      map.invalidateSize({ pan: false });
      if (open) map.fitBounds(allBounds(), { padding: [R * 0.5, R * 0.5], animate: false });
      else map.setView(markers.get(current).getLatLng(), insetZoom, { animate: false });
    },
  };
}
