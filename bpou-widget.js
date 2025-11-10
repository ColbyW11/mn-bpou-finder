(function(){
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadCSS(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  async function initBPOUWidget() {
    loadCSS("https://cdn.jsdelivr.net/npm/ol@7.4.0/ol.css");
    await loadScript("https://cdn.jsdelivr.net/npm/ol@7.4.0/dist/ol.js");

    const container = document.getElementById('bpou-widget');
    if (!container) return console.error("No element with id='bpou-widget' found!");

    container.innerHTML = `
      <input type="text" id="bpou-address" placeholder="Enter your address" style="width:100%;padding:0.5rem;margin-bottom:0.3rem;" />
      <button id="bpou-search" style="padding:0.5rem;width:100%;">Search</button>
      <div id="bpou-map" style="height:400px;margin-top:0.5rem;"></div>
      <div id="bpou-display" style="margin-top:0.5rem;font-weight:bold;">Your BPOU will appear here after search</div>
    `;

    const map = new ol.Map({
      target: 'bpou-map',
      layers: [
        new ol.layer.Tile({
          source: new ol.source.XYZ({
            url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
          })
        })
      ],
      view: new ol.View({
        center: ol.proj.fromLonLat([-94.5, 46.7]),
        zoom: 6
      })
    });

    // BPOU layer
    const bpouSource = new ol.source.Vector();
    const bpouLayer = new ol.layer.Vector({
      source: bpouSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#b22234', width: 2 }),
        fill: new ol.style.Fill({ color: 'rgba(178,34,52,0.25)' })
      })
    });
    map.addLayer(bpouLayer);

    // Internal CD source 
    const cdSource = new ol.source.Vector();

    const basePath = './';

    // Load BPOU map
    try {
      const bpouData = await fetch(basePath + 'BPOUMap.geojson').then(r => r.json());
      const bpouFeatures = new ol.format.GeoJSON().readFeatures(bpouData, { featureProjection: 'EPSG:3857' });
      bpouSource.addFeatures(bpouFeatures);
      console.log('Loaded BPOUs:', bpouFeatures.length);
    } catch (err) {
      console.warn('Failed to load BPOUMap.geojson:', err);
    }

    // Load CD map
    try {
      const cdData = await fetch(basePath + 'CDMap.geojson').then(r => r.json());
      const cdFeatures = new ol.format.GeoJSON().readFeatures(cdData, { featureProjection: 'EPSG:3857' });
      cdFeatures.forEach(f => {
        const districtID = f.get('DISTRICT') || f.get('ID1') || '?';
        f.set('CD', districtID);
      });
      cdSource.addFeatures(cdFeatures);
      console.log('Loaded CDMap');
    } catch (err) {
      console.warn('Failed to load CDMap.geojson:', err);
    }

    // Load contact info
    const [bpouContacts, cdContacts] = await Promise.all([
      fetch(basePath + 'bpouContacts.json').then(r => r.json()).catch(() => ({})),
      fetch(basePath + 'cdContacts.json').then(r => r.json()).catch(() => ({}))
    ]);

    // Search button
    document.getElementById('bpou-search').addEventListener('click', async () => {
      const addr = document.getElementById('bpou-address').value.trim();
      if (!addr) return alert('Enter an address');

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`);
        const data = await res.json();
        if (!data.length) return alert('Address not found. Try a more general location such as city, ZIP code, or street and city.');

        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        const point = ol.proj.fromLonLat([lon, lat]);

        map.getView().setCenter(point);
        map.getView().setZoom(13);

        // Clear old markers
        bpouSource.getFeatures().forEach(f => { if (f.get('isMarker')) bpouSource.removeFeature(f); });

        // Add new marker
        const marker = new ol.Feature({
          geometry: new ol.geom.Point(point),
          isMarker: true
        });
        bpouSource.addFeature(marker);

        // find BPOU
        let bpouName = null;
        bpouSource.getFeatures().forEach(f => {
          if (!f.get('isMarker') && f.getGeometry()?.intersectsCoordinate(point)) {
            bpouName = f.get('BPOU_NAME');
          }
        });

        // Determine CD
        const cdFeature = cdSource.getFeatures().find(f => f.getGeometry()?.intersectsCoordinate(point));
        const cdID = cdFeature?.get('CD') || '?';
        const cdURL = cdContacts[cdID]?.website || '#';

        const display = document.getElementById('bpou-display');
        let html = '';

        // BPOU website
        if (bpouName && bpouContacts[bpouName]?.website) {
          html += `
            Your local BPOU is: <strong>${bpouName}</strong><br>
            <a href="${bpouContacts[bpouName].website}" target="_blank" rel="noopener">Visit BPOU website</a><br><br>
          `;
        } else if (bpouName) {
          html += `
            Your local BPOU is: <strong>${bpouName}</strong><br>
            Couldn't find a local BPOU website.<br><br>
          `;
        } else {
          html += `Couldn't determine your BPOU.<br><br>`;
        }

        // Always add CD info
        html += `
          Your Congressional District is: <strong>${cdID}</strong><br>
          <a href="${cdURL}" target="_blank" rel="noopener">Visit Congressional District ${cdID} Republicans website</a>
        `;

        display.innerHTML = html;

      } catch (err) {
        console.error(err);
        alert('Error searching address');
      }
    });
  }

  initBPOUWidget();
})();
