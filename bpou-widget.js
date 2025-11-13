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
      <input type="text" id="bpou-street" placeholder="Street Address" style="width:100%;padding:0.5rem;margin-bottom:0.3rem;" />
      <input type="text" id="bpou-city" placeholder="City" style="width:100%;padding:0.5rem;margin-bottom:0.3rem;" />
      <input type="text" id="bpou-zip" placeholder="ZIP Code" style="width:100%;padding:0.5rem;margin-bottom:0.3rem;" />
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
        center: ol.proj.fromLonLat([-94, 46.5]),
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

    // Internal CD source
    const cdSource = new ol.source.Vector();

    // Map hover handler will be added after data is loaded

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

        if (bpouInfo.website) {
          html += `<a href="${bpouInfo.website}" target="_blank" rel="noopener">Visit BPOU website</a><br>`;
        } else {
          html += `<em>Website not yet available</em><br>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="margin-bottom:1rem;">Couldn't determine your BPOU.</div>`;
      }

      // CD info
      html += `<div>`;
      html += `Your Congressional District is: <strong>${cdID}</strong><br>`;

      if (cdInfo.website) {
        html += `<a href="${cdInfo.website}" target="_blank" rel="noopener">Visit CD ${cdID} Republicans website</a>`;
      }
      html += `</div>`;

      // Add "Suggest Changes" link
      const emailSubject = encodeURIComponent(`Find Your Local Republicans Page Suggestion`);
      const emailBody = encodeURIComponent(`I would like to suggest the following updates:\n\nBPOU: ${bpouName || 'N/A'}\nCongressional District: ${cdID}\n\nSuggested changes:\n`);
      html += `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #ccc;">`;
      html += `<a href="mailto:info@mngop.com?subject=${emailSubject}&body=${emailBody}">Suggest changes or updates</a>`;
      html += `</div>`;

      display.innerHTML = html;
    }

    // Lightweight function for hover display (no zoom, no marker)
    let lastHoveredBPOU = null;
    let hasClickedBPOU = false; // Track if user has clicked on a BPOU
    function displayHoverInfo(point) {
      // Don't update hover info if user has clicked on a BPOU
      if (hasClickedBPOU) return;

      // Find BPOU at this point
      let bpouName = null;
      bpouSource.getFeatures().forEach(f => {
        if (!f.get('isMarker') && f.getGeometry()?.intersectsCoordinate(point)) {
          bpouName = f.get('BPOU_NAME');
        }
      });

      // Only update if we're hovering over a different BPOU
      if (bpouName === lastHoveredBPOU) return;
      lastHoveredBPOU = bpouName;

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
        html += `BPOU: <strong>${bpouName}</strong><br>`;

        if (bpouInfo.website) {
          html += `<a href="${bpouInfo.website}" target="_blank" rel="noopener">Visit BPOU website</a><br>`;
        } else {
          html += `<em>Website not yet available</em><br>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="margin-bottom:1rem;">Hover over a BPOU to see information</div>`;
      }

      // CD info
      html += `<div>`;
      html += `Congressional District: <strong>${cdID}</strong><br>`;

      if (cdInfo.website) {
        html += `<a href="${cdInfo.website}" target="_blank" rel="noopener">Visit CD ${cdID} Republicans website</a>`;
      }
      html += `</div>`;

      // Add "Suggest Changes" link
      const emailSubject = encodeURIComponent(`Local Republicans Page Suggestion`);
      const emailBody = encodeURIComponent(`I would like to suggest the following updates:\n\nBPOU: ${bpouName || 'N/A'}\nCongressional District: ${cdID}\n\nSuggested changes:\n`);
      html += `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #ccc;">`;
      html += `<a href="mailto:info@mngop.com?subject=${emailSubject}&body=${emailBody}">Suggest changes or updates</a>`;
      html += `</div>`;

      display.innerHTML = html;
    }

    // Map hover handler - show info on mouse movement (set up after all data is loaded)
    map.on('pointermove', (evt) => {
      if (evt.dragging) return; // Don't show info while dragging
      displayHoverInfo(evt.coordinate);
    });

    // Map click handler - make popup "stick" when clicked
    map.on('click', async (evt) => {
      const point = evt.coordinate;
      const lonLat = ol.proj.toLonLat(point);
      const [lon, lat] = lonLat;

      // Find BPOU at clicked point
      let bpouName = null;
      bpouSource.getFeatures().forEach(f => {
        if (!f.get('isMarker') && f.getGeometry()?.intersectsCoordinate(point)) {
          bpouName = f.get('BPOU_NAME');
        }
      });

      // Only process if clicking on a BPOU
      if (bpouName) {
        hasClickedBPOU = true; // Set flag to prevent hover updates
        await processCoordinates(lat, lon, bpouName);
      }
    });

    // Add cursor pointer style to map
    map.getViewport().style.cursor = 'pointer';

    // Rate limiting for Nominatim API
    let lastNominatimCall = 0;
    const NOMINATIM_DELAY = 1000; // 1 second between requests

    // Search button
    document.getElementById('bpou-search').addEventListener('click', async () => {
      const street = document.getElementById('bpou-street').value.trim();
      const city = document.getElementById('bpou-city').value.trim();
      const zip = document.getElementById('bpou-zip').value.trim();

      // Input validation - at least one field must have content
      if (!street && !city && !zip) {
        return alert('Please enter at least a street address, city, or ZIP code');
      }

      const searchBtn = document.getElementById('bpou-search');
      const display = document.getElementById('bpou-display');
      const originalBtnText = searchBtn.textContent;

      // Show loading state
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching...';
      display.innerHTML = 'Searching for your location...';

      try {
        // Helper function to create address variations from structured fields
        function getAddressVariations(street, city, zip) {
          const variations = [];

          // Remove unit/apartment numbers from street
          const cleanStreet = street
            ? street.replace(/\s*(UNIT|APT|APARTMENT|#|STE|SUITE)\s*\d+[A-Z]?/gi, '').trim()
            : '';

          // Build full address with all fields
          const parts = [];
          if (cleanStreet) parts.push(cleanStreet);
          if (city) parts.push(city);
          parts.push('MN'); // Always include MN
          if (zip) parts.push(zip);

          if (parts.length > 1) {
            variations.push(parts.join(', '));
          }

          // Fallback: Street + MN + ZIP (skip city)
          if (cleanStreet && zip) {
            variations.push(`${cleanStreet}, MN ${zip}`);
          }

          // Fallback: City + MN + ZIP
          if (city && zip) {
            variations.push(`${city}, MN ${zip}`);
          }

          // Fallback: City + MN (no ZIP)
          if (city) {
            variations.push(`${city}, MN`);
          }

          // Fallback: Just ZIP code
          if (zip) {
            variations.push(zip);
          }

          // Remove duplicates
          return [...new Set(variations)];
        }

        // Rate limiting - wait if needed
        const now = Date.now();
        const timeSinceLastCall = now - lastNominatimCall;
        if (timeSinceLastCall < NOMINATIM_DELAY) {
          await new Promise(resolve => setTimeout(resolve, NOMINATIM_DELAY - timeSinceLastCall));
        }
        lastNominatimCall = Date.now();

        // Minnesota bounding box for more accurate results
        const mnBounds = 'viewbox=-97.5,43.5,-89.5,49.5&bounded=1';

        // Try multiple address variations
        const variations = getAddressVariations(street, city, zip);
        let data = null;
        let successfulAddress = null;
        const firstVariation = variations[0]; // Track first attempt to compare

        for (const variation of variations) {
          display.innerHTML = `Searching for: ${variation}...`;

          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(variation)}&countrycodes=us&${mnBounds}`,
            {
              headers: {
                'User-Agent': 'BPOU-Finder-Widget/1.0 (Minnesota Republican BPOU Locator)'
              }
            }
          );

          if (res.status === 429) {
            return alert('Too many requests. Please wait a moment and try again.');
          }

          const result = await res.json();
          if (result.length > 0) {
            data = result;
            successfulAddress = variation !== firstVariation ? variation : null;
            break;
          }

          // Wait between attempts
          if (variation !== variations[variations.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        if (!data || !data.length) {
          return alert('Address not found. Try entering just your city and state, or ZIP code.');
        }

        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);

        // Process coordinates and display results
        await processCoordinates(lat, lon);

        // Show feedback if we used a simplified address
        if (successfulAddress) {
          const display = document.getElementById('bpou-display');
          display.innerHTML = `<div style="margin-bottom:0.5rem;color:#666;font-size:0.9em;">Found using: ${successfulAddress}</div>` + display.innerHTML;
        }

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
