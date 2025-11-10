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
      <div style="display:flex;gap:0.3rem;margin-bottom:0.3rem;">
        <button id="bpou-search" style="padding:0.5rem;flex:1;">Search</button>
        <button id="bpou-locate" style="padding:0.5rem;flex:1;background:#b22234;color:white;border:none;cursor:pointer;">Use My Location</button>
      </div>
      <label style="display:flex;align-items:center;margin-bottom:0.3rem;font-size:0.9rem;">
        <input type="checkbox" id="bpou-show-boundaries" checked style="margin-right:0.3rem;" />
        Show BPOU boundaries
      </label>
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

    // BPOU layer with togglable boundaries
    let showBoundaries = true;
    const bpouSource = new ol.source.Vector();
    const bpouLayer = new ol.layer.Vector({
      source: bpouSource,
      style: function(feature) {
        // Style markers differently from polygons
        if (feature.get('isMarker')) {
          return new ol.style.Style({
            image: new ol.style.Circle({
              radius: 8,
              fill: new ol.style.Fill({ color: '#b22234' }),
              stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
            })
          });
        }
        // Show/hide polygon boundaries based on toggle
        if (!showBoundaries) {
          return null; // Hide boundaries
        }
        return new ol.style.Style({
          stroke: new ol.style.Stroke({ color: '#b22234', width: 2 }),
          fill: new ol.style.Fill({ color: 'rgba(178,34,52,0.25)' })
        });
      }
    });
    map.addLayer(bpouLayer);

    // Boundary toggle handler
    document.getElementById('bpou-show-boundaries').addEventListener('change', (e) => {
      showBoundaries = e.target.checked;
      bpouLayer.changed(); // Force layer to re-render
    });

    // Map click handler - click anywhere to find BPOU
    map.on('click', async (evt) => {
      const clickedCoord = evt.coordinate;
      const [lon, lat] = ol.proj.toLonLat(clickedCoord);

      // Process the clicked coordinates
      await processCoordinates(lat, lon);
    });

    // Internal CD source
    const cdSource = new ol.source.Vector();

    // Auto-detect the script's location for relative paths
    const scriptSrc = document.currentScript?.src;
    const basePath = scriptSrc
      ? scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1)
      : (window.BPOU_WIDGET_CONFIG?.basePath || './');

    const displayEl = document.getElementById('bpou-display');
    let loadErrors = [];

    // Load BPOU map
    try {
      displayEl.innerHTML = 'Loading BPOU map data...';
      const bpouData = await fetch(basePath + 'BPOUMap.geojson').then(r => r.json());
      const bpouFeatures = new ol.format.GeoJSON().readFeatures(bpouData, { featureProjection: 'EPSG:3857' });
      bpouSource.addFeatures(bpouFeatures);
      console.log('Loaded BPOUs:', bpouFeatures.length);
    } catch (err) {
      console.error('Failed to load BPOUMap.geojson:', err);
      loadErrors.push('Failed to load BPOU map data. The widget may not work correctly.');
    }

    // Load CD map
    try {
      displayEl.innerHTML = 'Loading Congressional District map data...';
      const cdData = await fetch(basePath + 'CDMap.geojson').then(r => r.json());
      const cdFeatures = new ol.format.GeoJSON().readFeatures(cdData, { featureProjection: 'EPSG:3857' });
      cdFeatures.forEach(f => {
        const districtID = f.get('DISTRICT') || f.get('ID1') || '?';
        f.set('CD', districtID);
      });
      cdSource.addFeatures(cdFeatures);
      console.log('Loaded CDMap');
    } catch (err) {
      console.error('Failed to load CDMap.geojson:', err);
      loadErrors.push('Failed to load Congressional District map data. The widget may not work correctly.');
    }

    // Show load status
    if (loadErrors.length > 0) {
      displayEl.innerHTML = `<span style="color: #b22234;">ERROR: ${loadErrors.join(' ')}</span>`;
    } else {
      displayEl.innerHTML = 'Your BPOU will appear here after search';
    }

    // Load contact info
    const [bpouContacts, cdContacts] = await Promise.all([
      fetch(basePath + 'bpouContacts.json').then(r => r.json()).catch(() => ({})),
      fetch(basePath + 'cdContacts.json').then(r => r.json()).catch(() => ({}))
    ]);

    // Shared function to process coordinates and display results
    async function processCoordinates(lat, lon, bpouName = null) {
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

      // Find BPOU if not provided
      if (!bpouName) {
        bpouSource.getFeatures().forEach(f => {
          if (!f.get('isMarker') && f.getGeometry()?.intersectsCoordinate(point)) {
            bpouName = f.get('BPOU_NAME');
          }
        });
      }

      // Determine CD
      const cdFeature = cdSource.getFeatures().find(f => f.getGeometry()?.intersectsCoordinate(point));
      const cdID = cdFeature?.get('CD') || '?';
      const cdInfo = cdContacts[cdID] || {};

      const display = document.getElementById('bpou-display');
      let html = '';

      // BPOU info
      const bpouInfo = bpouContacts[bpouName] || {};
      if (bpouName) {
        html += `<div style="margin-bottom:1rem;">`;
        html += `Your local BPOU is: <strong>${bpouName}</strong><br>`;

        // Website
        if (bpouInfo.website) {
          html += `<a href="${bpouInfo.website}" target="_blank" rel="noopener">Visit website</a><br>`;
        }

        // Phone
        if (bpouInfo.phone) {
          html += `Phone: <a href="tel:${bpouInfo.phone}">${bpouInfo.phone}</a><br>`;
        }

        // Email
        if (bpouInfo.email) {
          html += `Email: <a href="mailto:${bpouInfo.email}">${bpouInfo.email}</a><br>`;
        }

        // Social Media
        if (bpouInfo.facebook) {
          html += `<a href="${bpouInfo.facebook}" target="_blank" rel="noopener">Facebook</a> `;
        }
        if (bpouInfo.twitter) {
          html += `<a href="${bpouInfo.twitter}" target="_blank" rel="noopener">Twitter/X</a>`;
        }
        if (bpouInfo.facebook || bpouInfo.twitter) {
          html += `<br>`;
        }

        // Meeting Info
        if (bpouInfo.meetingInfo) {
          html += `<em>${bpouInfo.meetingInfo}</em><br>`;
        }

        if (!bpouInfo.website && !bpouInfo.phone && !bpouInfo.email && !bpouInfo.facebook && !bpouInfo.twitter) {
          html += `<em>Contact information not yet available</em><br>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="margin-bottom:1rem;">Couldn't determine your BPOU.</div>`;
      }

      // CD info
      html += `<div>`;
      html += `Your Congressional District is: <strong>${cdID}</strong><br>`;

      if (cdInfo.website) {
        html += `<a href="${cdInfo.website}" target="_blank" rel="noopener">Visit CD ${cdID} Republicans website</a><br>`;
      }

      // CD Phone
      if (cdInfo.phone) {
        html += `Phone: <a href="tel:${cdInfo.phone}">${cdInfo.phone}</a><br>`;
      }

      // CD Email
      if (cdInfo.email) {
        html += `Email: <a href="mailto:${cdInfo.email}">${cdInfo.email}</a><br>`;
      }

      // CD Social Media
      if (cdInfo.facebook) {
        html += `<a href="${cdInfo.facebook}" target="_blank" rel="noopener">Facebook</a> `;
      }
      if (cdInfo.twitter) {
        html += `<a href="${cdInfo.twitter}" target="_blank" rel="noopener">Twitter/X</a>`;
      }
      if (cdInfo.facebook || cdInfo.twitter) {
        html += `<br>`;
      }
      html += `</div>`;

      // Add "Suggest Changes" link
      const emailSubject = encodeURIComponent(`Find Your Local Republicans Page Suggestion`);
      html += `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #ccc;">`;
      html += `<a href="mailto:info@mngop.com?subject=${emailSubject}&body=${emailBody}" style="font-size:0.9rem;">Suggest changes or updates</a>`;
      html += `</div>`;

      display.innerHTML = html;
    }

    // Rate limiting for Nominatim API
    let lastNominatimCall = 0;
    const NOMINATIM_DELAY = 1000; // 1 second between requests

    // Search button
    document.getElementById('bpou-search').addEventListener('click', async () => {
      const addr = document.getElementById('bpou-address').value.trim();

      // Input validation
      if (!addr) return alert('Please enter an address');
      if (addr.length < 3) return alert('Please enter a valid address (at least 3 characters)');
      if (addr.length > 200) return alert('Address is too long');

      const searchBtn = document.getElementById('bpou-search');
      const display = document.getElementById('bpou-display');
      const originalBtnText = searchBtn.textContent;

      // Show loading state
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching...';
      display.innerHTML = 'Searching for your location...';

      try {
        // Rate limiting - wait if needed
        const now = Date.now();
        const timeSinceLastCall = now - lastNominatimCall;
        if (timeSinceLastCall < NOMINATIM_DELAY) {
          await new Promise(resolve => setTimeout(resolve, NOMINATIM_DELAY - timeSinceLastCall));
        }
        lastNominatimCall = Date.now();

        // Fetch with proper User-Agent header per Nominatim usage policy
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`, {
          headers: {
            'User-Agent': 'BPOU-Finder-Widget/1.0 (Minnesota Republican BPOU Locator)'
          }
        });

        if (res.status === 429) {
          return alert('Too many requests. Please wait a moment and try again.');
        }

        const data = await res.json();
        if (!data.length) return alert('Address not found. Try a more general location such as city, ZIP code, or street and city.');

        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);

        // Process coordinates and display results
        await processCoordinates(lat, lon);

      } catch (err) {
        console.error(err);
        display.innerHTML = 'Error searching address. Please try again.';
        alert('Error searching address. Please check your connection and try again.');
      } finally {
        // Restore button state
        searchBtn.disabled = false;
        searchBtn.textContent = originalBtnText;
      }
    });

    // Use My Location button
    document.getElementById('bpou-locate').addEventListener('click', async () => {
      const locateBtn = document.getElementById('bpou-locate');
      const display = document.getElementById('bpou-display');
      const originalBtnText = locateBtn.textContent;

      // Check if geolocation is supported
      if (!navigator.geolocation) {
        return alert('Geolocation is not supported by your browser.');
      }

      // Show loading state
      locateBtn.disabled = true;
      locateBtn.textContent = 'Getting location...';
      display.innerHTML = 'Getting your current location...';

      try {
        // Get current position
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          });
        });

        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        // Process coordinates and display results
        await processCoordinates(lat, lon);

      } catch (err) {
        console.error('Geolocation error:', err);

        // Provide specific error messages
        let errorMsg = 'Unable to get your location. ';
        if (err.code === 1) {
          errorMsg += 'Location permission was denied. Please enable location access in your browser settings.';
        } else if (err.code === 2) {
          errorMsg += 'Location information is unavailable.';
        } else if (err.code === 3) {
          errorMsg += 'Location request timed out.';
        } else {
          errorMsg += 'Please try entering your address manually.';
        }

        display.innerHTML = errorMsg;
        alert(errorMsg);
      } finally {
        // Restore button state
        locateBtn.disabled = false;
        locateBtn.textContent = originalBtnText;
      }
    });
  }

  initBPOUWidget();
})();
