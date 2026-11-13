const CONFIG = {
  API_PAISES_URL: 'https://api.restcountries.com/countries/v5',
  API_PAISES_KEY: 'rc_live_eff345f61f8f4f099dcd97776e0a8342',
  API_PAISES_FIELDS: [
    'names.common', 'names.translations.spa', 'capitals.name',
    'capitals.coordinates', 'region', 'subregion', 'population',
    'languages', 'currencies', 'flag.url_png', 'flag.url_svg',
    'coordinates', 'codes.alpha_2', 'codes.alpha_3'
  ].join(','),
  API_PAISES_PAGE_SIZE: 100,
  OPEN_METEO_URL: 'https://api.open-meteo.com/v1/forecast',
  NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
  NOMINATIM_MIN_INTERVAL: 1000,
  STORAGE: {
    favoritos: 'explorago_favs',
    viajes: 'explorago_viajes',
    lugares: 'explorago_lugares'
  },
  DESTACADOS: ['ESP', 'JPN', 'COL', 'CAN', 'ITA', 'AUS']
};

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

let paises = [];
let favoritos = leerFavoritos();
let viajes = leerViajes();
let lugaresGuardados = leerLugares();
let paisActual = null;
let viajeActivo = null;
let mapa = null;
let controladorLugares = null;
let resultadosLugares = [];
let ultimaConsultaNominatim = 0;

const esc = valor => String(valor ?? '').replace(/[&<>"']/g, caracter =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[caracter])
);

const formatearNumero = valor => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? new Intl.NumberFormat('es-CO').format(numero) : 'No disponible';
};

const formatearTemperatura = valor => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? `${Math.round(numero)} °C` : 'No disponible';
};

const formatearFecha = fecha => {
  if (!fecha) return 'Fecha no disponible';
  const fechaObjeto = new Date(`${fecha}T12:00:00`);
  return Number.isNaN(fechaObjeto.getTime())
    ? fecha
    : fechaObjeto.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
};

function debounce(funcion, espera = 450) {
  let temporizador;
  const ejecutar = (...argumentos) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => funcion(...argumentos), espera);
  };
  ejecutar.cancelar = () => clearTimeout(temporizador);
  return ejecutar;
}

async function solicitarJSON(url, opciones = {}) {
  const respuesta = await fetch(url, opciones);
  let datos = null;
  try { datos = await respuesta.json(); } catch {  }

  if (!respuesta.ok) {
    const error = new Error(
      datos?.errors?.[0]?.message || datos?.message || `Error HTTP ${respuesta.status}`
    );
    error.status = respuesta.status;
    throw error;
  }
  return datos;
}

function normalizarCoordenadas(valor) {
  if (Array.isArray(valor) && valor.length >= 2) {
    return [Number(valor[0]), Number(valor[1])];
  }
  if (valor && typeof valor === 'object') {
    return [
      Number(valor.lat ?? valor.latitude),
      Number(valor.lng ?? valor.lon ?? valor.longitude)
    ];
  }
  return [];
}

function nombreDeObjeto(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (!valor || typeof valor !== 'object') return '';
  return texto(valor.name) || texto(valor.common) || texto(valor.official) || '';
}

function extraerIdiomas(languages) {
  if (!languages) return 'No disponible';
  const lista = Array.isArray(languages)
    ? languages
    : typeof languages === 'object'
      ? Object.values(languages)
      : [languages];

  const nombres = lista.map(idioma =>
    typeof idioma === 'string'
      ? idioma.trim()
      : texto(idioma?.name) || texto(idioma?.common) || texto(idioma?.native_name) || ''
  ).filter(Boolean);

  return nombres.join(', ') || 'No disponible';
}

function extraerMonedas(currencies) {
  if (!currencies) return 'No disponible';
  const lista = Array.isArray(currencies)
    ? currencies
    : typeof currencies === 'object'
      ? Object.values(currencies)
      : [];

  const nombres = lista.map(moneda => {
    if (typeof moneda === 'string') return moneda.trim();
    const nombre = texto(moneda?.name) || texto(moneda?.common);
    const simbolo = texto(moneda?.symbol);
    return nombre && simbolo ? `${nombre} (${simbolo})` : nombre;
  }).filter(Boolean);

  return nombres.join(', ') || 'No disponible';
}

function extraerCapital(pais) {
  const lista = pais?.capitals || pais?.capital;
  const elementos = Array.isArray(lista) ? lista : [lista];
  for (const elemento of elementos) {
    const nombre = nombreDeObjeto(elemento);
    if (nombre) return nombre;
  }
  return 'No disponible';
}

function extraerBandera(pais, codigoDosLetras) {
  return (
    texto(pais?.flag?.url_png) ||
    texto(pais?.flag?.url_svg) ||
    texto(pais?.flags?.png) ||
    texto(pais?.flags?.svg) ||
    (codigoDosLetras
      ? `https://flags.restcountries.com/v5/w320/${codigoDosLetras.toLowerCase()}.png`
      : 'logotipo.png')
  );
}

const REGIONES = {
  Americas: 'América',
  Europe: 'Europa',
  Asia: 'Asia',
  Africa: 'África',
  Oceania: 'Oceanía',
  Antarctic: 'Antártida'
};

function mapearPais(pais) {
  const codigo = texto(pais?.codes?.alpha_3) || texto(pais?.cca3);
  const codigoDosLetras = texto(pais?.codes?.alpha_2) || texto(pais?.cca2);
  const capital = extraerCapital(pais);

  const coordenadasCapital = (Array.isArray(pais?.capitals) ? pais.capitals : [])
    .map(capitalItem => normalizarCoordenadas(capitalItem?.coordinates))
    .find(coordenadas => Number.isFinite(coordenadas[0]) && Number.isFinite(coordenadas[1]));

  let coordenadas = coordenadasCapital || normalizarCoordenadas(pais?.coordinates || pais?.latlng);
  if (!Number.isFinite(coordenadas[0]) || !Number.isFinite(coordenadas[1])) coordenadas = [];

  const subregion = texto(pais?.subregion);

  return {
    id: (codigo || codigoDosLetras).toLowerCase(),
    codigo,
    codigoDosLetras,
    nombre:
      texto(pais?.names?.translations?.spa?.common) ||
      texto(pais?.name?.common) ||
      texto(pais?.names?.common) ||
      texto(pais?.name) ||
      'Nombre no disponible',
    bandera: extraerBandera(pais, codigoDosLetras),
    capital,
    region: REGIONES[pais?.region] || texto(pais?.region) || 'No disponible',
    subregion: subregion || 'No disponible',
    poblacion: formatearNumero(pais?.population),
    idiomas: extraerIdiomas(pais?.languages),
    moneda: extraerMonedas(pais?.currencies),
    geografia: subregion ? `Ubicado en ${subregion}.` : 'Información geográfica no disponible.',
    coordenadas,
    clima: { temperatura: 'Pendiente', condicion: 'Consultar Open-Meteo', viento: 'Pendiente', pronostico: [] },
    lugares: [],
    destacado: CONFIG.DESTACADOS.includes(codigo)
  };
}

async function obtenerPaises() {
  const todosLosPaises = [];
  let offset = 0;
  let hayMas = true;

  while (hayMas) {
    const parametros = new URLSearchParams({
      limit: String(CONFIG.API_PAISES_PAGE_SIZE),
      offset: String(offset),
      response_fields: CONFIG.API_PAISES_FIELDS
    });

    const resultado = await solicitarJSON(
      `${CONFIG.API_PAISES_URL}?${parametros}`,
      { headers: { Authorization: `Bearer ${CONFIG.API_PAISES_KEY}` } }
    );

    const pagina = Array.isArray(resultado?.data?.objects) ? resultado.data.objects : [];
    todosLosPaises.push(...pagina);
    hayMas = resultado?.data?.meta?.more === true && pagina.length > 0;
    offset += CONFIG.API_PAISES_PAGE_SIZE;
  }

  return todosLosPaises
    .map(mapearPais)
    .filter(pais => pais.id && pais.nombre !== 'Nombre no disponible')
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

const ESTADOS_CLIMA = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha', 51: 'Llovizna ligera', 53: 'Llovizna moderada',
  55: 'Llovizna intensa', 56: 'Llovizna helada ligera', 57: 'Llovizna helada intensa',
  61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia intensa', 66: 'Lluvia helada ligera',
  67: 'Lluvia helada intensa', 71: 'Nevada ligera', 73: 'Nevada moderada', 75: 'Nevada intensa',
  77: 'Granizo pequeño', 80: 'Chubascos ligeros', 81: 'Chubascos moderados',
  82: 'Chubascos intensos', 85: 'Chubascos de nieve ligeros', 86: 'Chubascos de nieve intensos',
  95: 'Tormenta eléctrica', 96: 'Tormenta con granizo ligero', 99: 'Tormenta con granizo intenso'
};

async function obtenerClima(coordenadas) {
  const [latitud, longitud] = normalizarCoordenadas(coordenadas);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
    throw new Error('El país no tiene coordenadas válidas.');
  }

  const parametros = new URLSearchParams({
    latitude: String(latitud),
    longitude: String(longitud),
    current: 'temperature_2m,wind_speed_10m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '7',
    timezone: 'auto'
  });

  const datos = await solicitarJSON(`${CONFIG.OPEN_METEO_URL}?${parametros}`);
  if (!datos?.current || !datos?.daily) {
    throw new Error('La API del clima no devolvió los datos esperados.');
  }

  const fechas = Array.isArray(datos.daily.time) ? datos.daily.time : [];

  return {
    temperatura: formatearTemperatura(datos.current.temperature_2m),
    condicion: ESTADOS_CLIMA[datos.current.weather_code] || 'Condición no disponible',
    viento: Number.isFinite(Number(datos.current.wind_speed_10m))
      ? `${datos.current.wind_speed_10m} km/h`
      : 'No disponible',
    pronostico: fechas.map((fecha, indice) => ({
      fecha,
      maxima: datos.daily.temperature_2m_max?.[indice] ?? null,
      minima: datos.daily.temperature_2m_min?.[indice] ?? null,
      lluvia: datos.daily.precipitation_probability_max?.[indice] ?? null
    }))
  };
}

async function buscarLugares(consulta, nombrePais, signal) {
  const termino = texto(consulta);
  if (termino.length < 3) return [];

  const espera = Math.max(
    0,
    CONFIG.NOMINATIM_MIN_INTERVAL - (Date.now() - ultimaConsultaNominatim)
  );
  if (espera) await new Promise(resolver => setTimeout(resolver, espera));
  if (signal?.aborted) return [];

  ultimaConsultaNominatim = Date.now();

  const parametros = new URLSearchParams({
    q: `${termino}, ${nombrePais}`,
    format: 'json',
    addressdetails: '1',
    limit: '8',
    'accept-language': 'es'
  });

  const datos = await solicitarJSON(
    `${CONFIG.NOMINATIM_URL}?${parametros}`,
    { signal, headers: { Accept: 'application/json' } }
  );

  return (Array.isArray(datos) ? datos : []).filter(lugar =>
    Number.isFinite(Number(lugar.lat)) && Number.isFinite(Number(lugar.lon))
  );
}

function leerStorage(clave, valorPredeterminado) {
  try {
    const valor = localStorage.getItem(clave);
    if (valor === null) return valorPredeterminado;
    return JSON.parse(valor) ?? valorPredeterminado;
  } catch (error) {
    console.warn(`No se pudo leer "${clave}" de LocalStorage:`, error);
    return valorPredeterminado;
  }
}

function escribirStorage(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch (error) {
    console.warn(`No se pudo guardar "${clave}" en LocalStorage:`, error);
    return false;
  }
}

function leerFavoritos() {
  const datos = leerStorage(CONFIG.STORAGE.favoritos, []);
  if (!Array.isArray(datos)) return [];
  return [...new Set(
    datos.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
  )];
}

function guardarFavoritos() {
  favoritos = [...new Set(favoritos)];
  escribirStorage(CONFIG.STORAGE.favoritos, favoritos);
}

function leerViajes() {
  const datos = leerStorage(CONFIG.STORAGE.viajes, []);
  if (!Array.isArray(datos)) return [];

  const unicos = new Map();
  datos.forEach(viaje => {
    if (viaje?.id) unicos.set(String(viaje.id), viaje);
  });

  return [...unicos.values()].map(viaje => ({
    ...viaje,
    id: String(viaje.id),
    nombre: texto(viaje.nombre) || 'Viaje sin nombre',
    destino: texto(viaje.destino) || 'Destino no definido',
    dias: Array.isArray(viaje.dias)
      ? viaje.dias.map((dia, indice) => ({
          ...dia,
          dia: Number(dia?.dia) || indice + 1,
          actividades: Array.isArray(dia?.actividades)
            ? dia.actividades.filter(actividad => typeof actividad === 'string' && actividad.trim())
            : []
        }))
      : []
  }));
}

function guardarViajesEnStorage() {
  viajes = [...new Map(viajes.map(viaje => [viaje.id, viaje])).values()];
  escribirStorage(CONFIG.STORAGE.viajes, viajes);
}

function leerLugares() {
  const datos = leerStorage(CONFIG.STORAGE.lugares, {});
  return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
}

function lugaresDePais(id) {
  const lista = lugaresGuardados[id];
  return Array.isArray(lista)
    ? [...new Set(lista.filter(nombre => typeof nombre === 'string' && nombre.trim()))]
    : [];
}

function guardarLugar(idPais, nombre) {
  const lista = lugaresDePais(idPais);
  const existe = lista.some(item => item.toLowerCase() === nombre.toLowerCase());
  if (!existe) lista.push(nombre);
  lugaresGuardados[idPais] = lista;
  escribirStorage(CONFIG.STORAGE.lugares, lugaresGuardados);
  return lista;
}

function crearCardPais(pais) {
  const esFavorito = favoritos.includes(pais.id);
  return `
    <div class="card">
      <img src="${esc(pais.bandera || 'logotipo.png')}" alt="${esc(pais.nombre)}" class="card-img" />
      <button class="btn-ico btn-fav" onclick="alternarFavorito('${pais.id}')">
        ${esFavorito ? '❤️' : '🤍'}
      </button>
      <div class="card-body">
        <h3 class="card-txt">${esc(pais.nombre)}</h3>
        <p class="card-info"><strong>Capital:</strong> ${esc(pais.capital)}</p>
        <p class="card-info"><strong>Región:</strong> ${esc(pais.region)}</p>
        <p class="card-info"><strong>Población:</strong> ${pais.poblacion}</p>
        <div class="card-acciones">
          <button class="btn btn-primario" style="width:100%;" onclick="verDetallePais('${pais.id}')">
            Ver detalles
          </button>
        </div>
      </div>
    </div>`;
}

function renderizarGrid(idContenedor, lista) {
  const contenedor = document.getElementById(idContenedor);
  if (contenedor) contenedor.innerHTML = lista.map(crearCardPais).join('');
}

function renderizarDestacados() {
  renderizarGrid('grid-destacados', paises.filter(pais => pais.destacado));
}

function filtrarPaises() {
  const entrada = document.getElementById('filtro-busqueda');
  const filtroRegion = document.getElementById('filtro-region');
  if (!entrada || !filtroRegion) return;

  const consulta = entrada.value.toLowerCase().trim();
  const region = filtroRegion.value;

  renderizarGrid('grid-explorar', paises.filter(pais =>
    (pais.nombre.toLowerCase().includes(consulta) || pais.capital.toLowerCase().includes(consulta)) &&
    (!region || pais.region === region)
  ));
}

function renderizarFavoritos() {
  const contenedor = document.getElementById('grid-favoritos');
  if (!contenedor) return;

  const lista = paises.filter(pais => favoritos.includes(pais.id));
  if (lista.length) {
    contenedor.innerHTML = lista.map(crearCardPais).join('');
    return;
  }

  contenedor.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:3rem;background:var(--blanco);border-radius:var(--radio);">
      <p style="color:var(--txt-gris);font-size:1.1rem;">No tienes destinos guardados en tus favoritos.</p>
      <button class="btn btn-primario" style="margin-top:1rem;" onclick="navegarA('explorar')">
        Explorar Destinos
      </button>
    </div>`;
}

function crearHTMLClima(pais) {
  const clima = pais.clima || {};
  const pronostico = Array.isArray(clima.pronostico) ? clima.pronostico : [];

  return `
    <div class="card-clima" data-pais-id="${pais.id}">
      <h3>Clima actual en ${esc(pais.capital)}</h3>
      <div style="display:flex;gap:2rem;align-items:center;margin-top:1rem;flex-wrap:wrap;">
        <div style="font-size:2.5rem;font-weight:800;">${clima.temperatura || 'Cargando...'}</div>
        <div>
          <p><strong>Estado:</strong> ${clima.condicion || 'Consultando...'}</p>
          <p><strong>Viento:</strong> ${clima.viento || 'Pendiente'}</p>
        </div>
      </div>
      <h4 style="margin-top:1.5rem;">Pronóstico de los próximos 7 días</h4>
      <div class="grid-clima">
        ${pronostico.length
          ? pronostico.map(dia => `
              <div class="dia-clima">
                <strong>${formatearFecha(dia.fecha)}</strong>
                <strong>Máxima: ${dia.maxima ?? 'No disponible'} °C</strong>
                <p>Mínima: ${dia.minima ?? 'No disponible'} °C</p>
                <p>Lluvia: ${dia.lluvia ?? 'No disponible'}%</p>
              </div>`).join('')
          : '<p>Cargando información meteorológica...</p>'}
      </div>
      <p style="font-size:0.8rem;margin-top:1rem;">Fuente: Open-Meteo</p>
    </div>`;
}

function htmlListaLugares(pais) {
  return pais.lugares?.length
    ? pais.lugares.map(lugar => `<li>${esc(lugar)}</li>`).join('')
    : '<li>No hay lugares registrados todavía. Utiliza el buscador para encontrar sitios de interés.</li>';
}

function crearHTMLDetalle(pais) {
  const esFavorito = favoritos.includes(pais.id);
  return `
    <div class="box-detalle">
      <img src="${esc(pais.bandera || 'logotipo.png')}" alt="${esc(pais.nombre)}" class="img-detalle" />
      <div class="info-detalle">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <h1 style="font-size:2.25rem;">${esc(pais.nombre)}</h1>
          <button id="btn-fav-detalle" class="btn btn-secundario" onclick="alternarFavorito('${pais.id}')">
            ${esFavorito ? '❤️ Guardado' : '🤍 Guardar en favoritos'}
          </button>
        </div>
        <div class="grid-info">
          <div class="item-info"><span>Capital</span><strong>${esc(pais.capital)}</strong></div>
          <div class="item-info"><span>Región</span><strong>${esc(pais.region)}</strong></div>
          <div class="item-info"><span>Población</span><strong>${pais.poblacion}</strong></div>
          <div class="item-info"><span>Idiomas</span><strong>${esc(pais.idiomas)}</strong></div>
          <div class="item-info"><span>Moneda</span><strong>${esc(pais.moneda)}</strong></div>
        </div>
        <p style="color:var(--txt-gris);">${esc(pais.geografia)}</p>
      </div>
    </div>

    ${crearHTMLClima(pais)}

    <div class="contenedor-mapa">
      <h3>Ubicación geográfica</h3>
      <p style="margin-bottom:1rem;">Explora la ubicación de ${esc(pais.nombre)} y su capital ${esc(pais.capital)}.</p>
      <div id="mapa-destino"></div>
    </div>

    <div class="contenedor-lugares">
      <h3>Explorar lugares de interés</h3>
      <p>Encuentra sitios turísticos y lugares destacados de este destino.</p>
      <div class="buscador-lugares">
        <input type="text" id="busqueda-lugares" placeholder="Ej. museos, parques, monumentos...">
        <button class="btn btn-primario" onclick="buscarLugaresPais()">Buscar lugares</button>
      </div>
      <div id="resultados-lugares"><p>Escribe qué lugar deseas encontrar.</p></div>
    </div>

    <div class="contenedor-lugares">
      <h3>Lugares de Interés</h3>
      <ul id="lista-lugares" class="lista-lugares">${htmlListaLugares(pais)}</ul>
    </div>`;
}

function renderizarListaLugares() {
  const contenedor = document.getElementById('lista-lugares');
  if (contenedor && paisActual) contenedor.innerHTML = htmlListaLugares(paisActual);
}

function mostrarResultadosLugares(lugares) {
  const contenedor = document.getElementById('resultados-lugares');
  if (!contenedor) return;

  resultadosLugares = lugares;

  if (!lugares.length) {
    contenedor.innerHTML = '<p>No encontramos lugares para esta búsqueda.</p>';
    return;
  }

  const guardados = paisActual ? lugaresDePais(paisActual.id) : [];

  contenedor.innerHTML = lugares.map((lugar, indice) => {
    const nombre = texto(lugar.name) || texto(lugar.display_name);
    const yaGuardado = guardados.some(item => item.toLowerCase() === nombre.toLowerCase());

    return `
      <div class="resultado-lugar">
        <h4>${esc(nombre)}</h4>
        <p>${esc(lugar.display_name)}</p>
        <div class="acciones-lugar">
          <button class="btn btn-primario" onclick="agregarLugar(${indice})" ${yaGuardado ? 'disabled' : ''}>
            ${yaGuardado ? '✓ Agregado' : '+ Agregar'}
          </button>
          <button class="btn btn-secundario" onclick="ubicarLugar(${indice})">Ver en el mapa</button>
        </div>
      </div>`;
  }).join('');
}

function renderizarMapa(pais) {
  const contenedor = document.getElementById('mapa-destino');
  if (!contenedor || !window.L) return;

  const [latitud, longitud] = pais.coordenadas || [];
  if (
    !Number.isFinite(latitud) || !Number.isFinite(longitud) ||
    Math.abs(latitud) > 90 || Math.abs(longitud) > 180
  ) {
    contenedor.textContent = 'No hay coordenadas disponibles para este destino.';
    return;
  }

  if (mapa) {
    mapa.remove();
    mapa = null;
  }

  mapa = L.map('mapa-destino').setView([latitud, longitud], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(mapa);

  L.marker([latitud, longitud])
    .addTo(mapa)
    .bindPopup(`<strong>${esc(pais.nombre)}</strong><br>Capital: ${esc(pais.capital)}`)
    .openPopup();

  requestAnimationFrame(() => mapa?.invalidateSize());
}

function renderizarOpcionesDestino(filtro = '') {
  const lista = document.getElementById('lista-destinos');
  if (!lista) return;

  const consulta = filtro.trim().toLowerCase();
  const opciones = paises
    .filter(pais => pais.nombre.toLowerCase().includes(consulta))
    .slice(0, 50);

  lista.innerHTML = opciones.length
    ? opciones.map(pais =>
        `<button type="button" class="opcion-destino" data-destino="${esc(pais.nombre)}">${esc(pais.nombre)}</button>`
      ).join('')
    : '<p class="sin-opciones">No se encontraron países.</p>';

  lista.hidden = false;
}

function renderizarListaViajes(contenedor) {
  contenedor.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;gap:1rem;flex-wrap:wrap;">
      <h2 class="titulo-sec" style="margin-bottom:0;">Mis Viajes Planificados</h2>
      <button class="btn btn-primario" onclick="navegarA('planificador')">+ Crear Nuevo Viaje</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem;">
      ${viajes.map(viaje => `
        <div class="card" style="padding:1.5rem;">
          <h3 style="font-size:1.25rem;margin-bottom:0.25rem;">${esc(viaje.nombre)}</h3>
          <p style="color:var(--primario);font-weight:600;margin-bottom:0.75rem;">Destino: ${esc(viaje.destino)}</p>
          <p class="card-info"><strong>Fechas:</strong> ${esc(viaje.fechaInicio)} / ${esc(viaje.fechaFin)}</p>
          <p class="card-info"><strong>Viajeros:</strong> ${esc(viaje.viajeros)} pna(s)</p>
          <p class="card-info"><strong>Presupuesto:</strong> $${esc(viaje.presupuesto)} USD</p>
          <div style="display:flex;gap:0.5rem;margin-top:1rem;">
            <button class="btn btn-primario" style="flex:1;" onclick="seleccionarViaje('${viaje.id}')">Ver Itinerario</button>
            <button class="btn btn-peligro" onclick="eliminarViaje('${viaje.id}')">🗑️</button>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderizarDetalleViaje(contenedor, viaje) {
  contenedor.innerHTML = `
    <button class="btn btn-secundario" style="margin-bottom:1.5rem;" onclick="volverAListaViajes()">
      ← Volver a Mis Viajes
    </button>

    <div class="box-itinerario">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;">
        <div>
          <h2>${esc(viaje.nombre)}</h2>
          <p style="color:var(--primario);font-weight:600;">Destino: ${esc(viaje.destino)}</p>
        </div>
        <button class="btn btn-peligro" onclick="eliminarViaje('${viaje.id}')">Eliminar Viaje</button>
      </div>

      <div class="grid-info" style="margin-top:1rem;">
        <div class="item-info"><span>Fechas</span><strong>${esc(viaje.fechaInicio)} / ${esc(viaje.fechaFin)}</strong></div>
        <div class="item-info"><span>Viajeros</span><strong>${esc(viaje.viajeros)} pna(s)</strong></div>
        <div class="item-info"><span>Presupuesto</span><strong>$${esc(viaje.presupuesto)} USD</strong></div>
      </div>

      ${viaje.notas ? `<p style="font-size:0.9rem;color:var(--txt-gris);"><strong>Notas:</strong> ${esc(viaje.notas)}</p>` : ''}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:1rem;flex-wrap:wrap;">
      <h3>Itinerario por Días</h3>
      <button class="btn btn-secundario" onclick="agregarDiaItinerario()">+ Agregar Día</button>
    </div>

    <div id="contenedor-dias">
      ${viaje.dias.map((dia, indiceDia) => `
        <div class="box-dia">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h4>Día ${dia.dia}</h4>
            <button class="btn btn-secundario" style="padding:0.25rem 0.5rem;font-size:0.8rem;"
              onclick="agregarActividad(${indiceDia})">+ Actividad</button>
          </div>
          <ul class="lista-actividades">
            ${dia.actividades.map((actividad, indiceActividad) => `
              <li class="item-actividad">
                <span>${esc(actividad)}</span>
                <button class="btn-ico" style="box-shadow:none;"
                  onclick="eliminarActividad(${indiceDia}, ${indiceActividad})">🗑️</button>
              </li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>`;
}

function renderizarItinerarios() {
  const contenedor = document.getElementById('contenido-itinerarios');
  if (!contenedor) return;

  if (!viajes.length) {
    contenedor.innerHTML = `
      <div style="text-align:center;padding:3rem;background:var(--blanco);border-radius:var(--radio);">
        <h2>No tienes ningún viaje planificado</h2>
        <p style="color:var(--txt-gris);margin:0.5rem 0 1.5rem 0;">Utiliza nuestro planificador para crear tu primer viaje.</p>
        <button class="btn btn-primario" onclick="navegarA('planificador')">Ir al Planificador</button>
      </div>`;
    return;
  }

  const viaje = viajes.find(item => item.id === viajeActivo);
  if (!viajeActivo || !viaje) {
    viajeActivo = null;
    renderizarListaViajes(contenedor);
    return;
  }

  renderizarDetalleViaje(contenedor, viaje);
}

function alternarMenuMovil() {
  document.getElementById('nav-links')?.classList.toggle('activo');
  document.getElementById('btn-hamb')?.classList.toggle('activo');
}

function cerrarMenuMovil() {
  document.getElementById('nav-links')?.classList.remove('activo');
  document.getElementById('btn-hamb')?.classList.remove('activo');
}

function navegarA(idVista, opciones = {}) {
  document.querySelectorAll('.vista').forEach(vista =>
    vista.classList.toggle('activo', vista.id === `vista-${idVista}`)
  );
  document.querySelectorAll('.nav-links a').forEach(enlace =>
    enlace.classList.toggle('activo', enlace.id === `nav-${idVista}`)
  );

  if (idVista === 'inicio') renderizarDestacados();
  if (idVista === 'explorar') filtrarPaises();
  if (idVista === 'favoritos') renderizarFavoritos();
  if (idVista === 'itinerarios') {
    if (!opciones.mantenerViaje) viajeActivo = null;
    renderizarItinerarios();
  }

  cerrarMenuMovil();
  window.scrollTo(0, 0);
}

function actualizarContadorFavoritos() {
  const contador = document.getElementById('cant-favs');
  if (contador) contador.textContent = favoritos.length;
}

function alternarFavorito(id) {
  favoritos = favoritos.includes(id)
    ? favoritos.filter(favorito => favorito !== id)
    : [...favoritos, id];
  guardarFavoritos();
  actualizarContadorFavoritos();

  const vistaActiva = document.querySelector('.vista.activo')?.id;
  if (vistaActiva === 'vista-explorar') filtrarPaises();
  if (vistaActiva === 'vista-inicio') renderizarDestacados();
  if (vistaActiva === 'vista-favoritos') renderizarFavoritos();

  if (paisActual?.id === id) {
    const boton = document.getElementById('btn-fav-detalle');
    if (boton) {
      boton.textContent = favoritos.includes(id)
        ? '❤️ Guardado'
        : '🤍 Guardar en favoritos';
    }
  }
}

function detectarEnterHero(evento) {
  if (evento.key === 'Enter') procesarBusquedaHero();
}

function procesarBusquedaHero() {
  const entrada = document.getElementById('busqueda-hero');
  const filtro = document.getElementById('filtro-busqueda');
  if (!entrada || !filtro) return;
  filtro.value = entrada.value;
  navegarA('explorar');
}

async function cargarPaises() {
  try {
    paises = await obtenerPaises();
    return true;
  } catch (error) {
    console.error('Error al cargar países:', error);
    return false;
  }
}

async function consultarClimaPais(pais) {
  try {
    pais.clima = await obtenerClima(pais.coordenadas);
    return true;
  } catch (error) {
    console.error('Error consultando Open-Meteo:', error);
    return false;
  }
}

async function verDetallePais(id) {
  const pais = paises.find(item => item.id === id);
  if (!pais) return;

  buscarLugaresDebounce.cancelar();
  if (controladorLugares) {
    controladorLugares.abort();
    controladorLugares = null;
  }

  paisActual = pais;
  resultadosLugares = [];
  pais.lugares = lugaresDePais(pais.id);
  pais.clima = {
    temperatura: 'Consultando...',
    condicion: 'Obteniendo información meteorológica',
    viento: 'Pendiente',
    pronostico: []
  };

  const contenedor = document.getElementById('detalle-pais');
  if (!contenedor) return;
  contenedor.innerHTML = crearHTMLDetalle(pais);

  navegarA('detalle');
  configurarBuscadorLugares();
  renderizarMapa(pais);

  const actualizado = await consultarClimaPais(pais);
  if (paisActual?.id !== pais.id) return;

  const tarjeta = document.querySelector('#detalle-pais .card-clima');
  if (!tarjeta) return;

  if (actualizado) {
    tarjeta.outerHTML = crearHTMLClima(pais);
  } else {
    tarjeta.innerHTML = `
      <h3>No se pudo consultar el clima</h3>
      <p>Comprueba tu conexión e inténtalo nuevamente.</p>
      <button class="btn btn-primario" onclick="verDetallePais('${pais.id}')">Reintentar consulta</button>`;
  }
}

function configurarBuscadorLugares() {
  const entrada = document.getElementById('busqueda-lugares');
  if (!entrada) return;

  entrada.addEventListener('input', buscarLugaresDebounce);
  entrada.addEventListener('keydown', evento => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      buscarLugaresPais();
    }
  });
}

const buscarLugaresDebounce = debounce(buscarLugaresPais, 450);

async function buscarLugaresPais() {
  buscarLugaresDebounce.cancelar();

  const entrada = document.getElementById('busqueda-lugares');
  const contenedor = document.getElementById('resultados-lugares');
  if (!entrada || !contenedor || !paisActual) return;

  const consulta = entrada.value.trim();
  if (consulta.length < 3) {
    contenedor.innerHTML = '<p>Escribe al menos 3 caracteres.</p>';
    return;
  }

  if (controladorLugares) controladorLugares.abort();
  controladorLugares = new AbortController();
  const { signal } = controladorLugares;

  contenedor.innerHTML = '<p>Buscando lugares...</p>';

  try {
    const lugares = await buscarLugares(consulta, paisActual.nombre, signal);
    if (signal.aborted || !paisActual) return;
    mostrarResultadosLugares(lugares);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Error buscando lugares:', error);
    contenedor.innerHTML = '<p>No fue posible consultar los lugares. Inténtalo nuevamente más tarde.</p>';
  }
}

function agregarLugar(indice) {
  const lugar = resultadosLugares[indice];
  if (!lugar || !paisActual) return;

  const nombre = texto(lugar.name) || texto(lugar.display_name);
  if (!nombre) return;

  paisActual.lugares = guardarLugar(paisActual.id, nombre);
  renderizarListaLugares();
  mostrarResultadosLugares(resultadosLugares);
}

function ubicarLugar(indice) {
  const lugar = resultadosLugares[indice];
  if (!lugar || !mapa || !window.L) return;

  const latitud = Number(lugar.lat);
  const longitud = Number(lugar.lon);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) return;

  mapa.setView([latitud, longitud], 16);
  L.marker([latitud, longitud])
    .addTo(mapa)
    .bindPopup(`<strong>${esc(lugar.name || 'Lugar encontrado')}</strong>`)
    .openPopup();
}

function configurarBuscadorDestino() {
  const entrada = document.getElementById('viaje-destino');
  const lista = document.getElementById('lista-destinos');
  if (!entrada || !lista) return;

  const mostrarOpciones = () => renderizarOpcionesDestino(entrada.value);
  entrada.addEventListener('focus', mostrarOpciones);
  entrada.addEventListener('input', mostrarOpciones);

  lista.addEventListener('click', evento => {
    const opcion = evento.target.closest('[data-destino]');
    if (!opcion) return;
    entrada.value = opcion.dataset.destino;
    lista.hidden = true;
    entrada.focus();
  });

  entrada.addEventListener('keydown', evento => {
    if (evento.key === 'Escape') lista.hidden = true;
    if (evento.key === 'Enter' && !lista.hidden) {
      const primera = lista.querySelector('[data-destino]');
      if (primera) {
        evento.preventDefault();
        entrada.value = primera.dataset.destino;
        lista.hidden = true;
      }
    }
  });

  document.addEventListener('click', evento => {
    if (!evento.target.closest('.buscador-destino')) lista.hidden = true;
  });
}

function procesarCrearViaje(evento) {
  evento.preventDefault();

  const entradaDestino = document.getElementById('viaje-destino');
  const destino = entradaDestino.value.trim();
  const paisDestino = paises.find(pais =>
    pais.nombre.toLowerCase() === destino.toLowerCase()
  );

  if (!paisDestino) {
    alert('Selecciona un país de la lista de destinos.');
    entradaDestino.focus();
    return;
  }

  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const nuevoViaje = {
    id,
    nombre: document.getElementById('viaje-nombre').value.trim(),
    destino: paisDestino.nombre,
    fechaInicio: document.getElementById('viaje-inicio').value,
    fechaFin: document.getElementById('viaje-fin').value,
    viajeros: document.getElementById('viaje-viajeros').value,
    presupuesto: document.getElementById('viaje-presupuesto').value,
    notas: document.getElementById('viaje-notas').value.trim(),
    dias: [
      { dia: 1, actividades: ['Llegada al destino y registro en hotel', 'Paseo por el centro histórico'] },
      { dia: 2, actividades: ['Visita a los museos principales', 'Cena en un restaurante tradicional'] }
    ]
  };

  viajes.push(nuevoViaje);
  guardarViajesEnStorage();
  evento.target.reset();
  viajeActivo = id;
  navegarA('itinerarios', { mantenerViaje: true });
}

function seleccionarViaje(id) {
  viajeActivo = id;
  renderizarItinerarios();
}

function volverAListaViajes() {
  viajeActivo = null;
  renderizarItinerarios();
}

function agregarDiaItinerario() {
  const viaje = viajes.find(item => item.id === viajeActivo);
  if (!viaje) return;

  const siguienteDia = viaje.dias.reduce(
    (mayor, dia) => Math.max(mayor, Number(dia.dia) || 0),
    0
  ) + 1;

  viaje.dias.push({ dia: siguienteDia, actividades: ['Nueva actividad planificada'] });
  guardarViajesEnStorage();
  renderizarItinerarios();
}

function agregarActividad(indiceDia) {
  const viaje = viajes.find(item => item.id === viajeActivo);
  if (!viaje) return;

  const actividad = prompt('Ingresa la nueva actividad:');
  const textoActividad = texto(actividad);
  if (!textoActividad) return;

  const dia = viaje.dias[indiceDia];
  if (!dia) return;

  if (!Array.isArray(dia.actividades)) dia.actividades = [];
  if (!dia.actividades.includes(textoActividad)) dia.actividades.push(textoActividad);

  guardarViajesEnStorage();
  renderizarItinerarios();
}

function eliminarActividad(indiceDia, indiceActividad) {
  const viaje = viajes.find(item => item.id === viajeActivo);
  const dia = viaje?.dias[indiceDia];
  if (!dia || !Array.isArray(dia.actividades)) return;

  dia.actividades.splice(indiceActividad, 1);
  guardarViajesEnStorage();
  renderizarItinerarios();
}

function eliminarViaje(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este viaje?')) return;

  viajes = viajes.filter(viaje => viaje.id !== id);
  guardarViajesEnStorage();
  viajeActivo = null;
  renderizarItinerarios();
}

document.addEventListener('DOMContentLoaded', async () => {
  actualizarContadorFavoritos();
  configurarBuscadorDestino();

  const cargado = await cargarPaises();

  if (cargado) {
    renderizarDestacados();
    renderizarGrid('grid-explorar', paises);
    return;
  }

  const destacados = document.getElementById('grid-destacados');
  const explorar = document.getElementById('grid-explorar');
  if (destacados) {
    destacados.innerHTML = '<p>No se pudieron cargar los destinos. Comprueba tu conexión e inténtalo nuevamente.</p>';
  }
  if (explorar) {
    explorar.innerHTML = '<p>Error al conectar con REST Countries.</p>';
  }
});
