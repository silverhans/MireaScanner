import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const CAMPUSES = [
  {
    id: 'v-78',
    shortName: 'В-78',
    fullName: 'Проспект Вернадского, 78',
    floors: ['0', '1', '2', '3', '4']
  },
  {
    id: 's-20',
    shortName: 'С-20',
    fullName: 'Улица Стромынка, 20',
    floors: ['1', '2', '3', '4']
  },
  {
    id: 'mp-1',
    shortName: 'МП-1',
    fullName: 'Малая Пироговская, 1',
    floors: ['-1', '1', '2', '3', '4', '5']
  }
]

const MAPS_VERSION = '20260211-opt1'

function buildMapSrc(campusId, floor) {
  if (campusId === 'v-78' || campusId === 's-20') {
    return `/maps/${campusId}/floor_${floor}.svg?v=${MAPS_VERSION}`
  }
  return `/maps/${campusId}/${floor}.svg?v=${MAPS_VERSION}`
}

export default function MapsTab({ tabDirection }) {
  const [campusId, setCampusId] = useState(CAMPUSES[0].id)
  const [floor, setFloor] = useState(CAMPUSES[0].floors[0])
  const [imageLoading, setImageLoading] = useState(true)
  const [imageError, setImageError] = useState(false)
  const [imageErrorText, setImageErrorText] = useState('')
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [loadedSrc, setLoadedSrc] = useState('')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [roomIndex, setRoomIndex] = useState(null)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [highlightPos, setHighlightPos] = useState(null)
  const searchInputRef = useRef(null)

  const viewportRef = useRef(null)
  const viewRef = useRef(view)
  const mapMetaCacheRef = useRef(new Map())
  const pointersRef = useRef(new Map())
  const dragRef = useRef(null)
  const pinchRef = useRef(null)

  const campus = useMemo(
    () => CAMPUSES.find((item) => item.id === campusId) || CAMPUSES[0],
    [campusId]
  )

  useEffect(() => {
    if (!campus.floors.includes(floor)) {
      setFloor(campus.floors[0])
    }
  }, [campus, floor])

  useEffect(() => {
    fetch(`/maps/room-index.json?v=${MAPS_VERSION}`)
      .then(r => r.ok ? r.json() : [])
      .then(setRoomIndex)
      .catch(() => {})
  }, [])

  const searchResults = useMemo(() => {
    if (!roomIndex || searchQuery.length < 2) return []
    const q = searchQuery.toLowerCase().replace(/[\s-]/g, '')
    return roomIndex
      .filter(r => r.n.toLowerCase().replace(/[\s-]/g, '').includes(q))
      .slice(0, 8)
  }, [roomIndex, searchQuery])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setSelectedRoom(null)
    setHighlightPos(null)
    searchInputRef.current?.focus()
  }, [])

  const imageSrc = useMemo(() => buildMapSrc(campus.id, floor), [campus.id, floor])
  const minZoom = 1
  const maxZoom = 8

  const baseScale = useMemo(() => {
    if (!imageSize.width || !imageSize.height || !viewportSize.width || !viewportSize.height) return 1
    return Math.min(viewportSize.width / imageSize.width, viewportSize.height / imageSize.height)
  }, [imageSize.width, imageSize.height, viewportSize.width, viewportSize.height])

  const clampZoom = (value) => Math.max(minZoom, Math.min(maxZoom, value))

  const clampPan = (nextX, nextY, nextZoom) => {
    if (!imageSize.width || !imageSize.height || !viewportSize.width || !viewportSize.height) {
      return { x: nextX, y: nextY }
    }

    const scaledWidth = imageSize.width * baseScale * nextZoom
    const scaledHeight = imageSize.height * baseScale * nextZoom

    let x = nextX
    let y = nextY

    if (scaledWidth <= viewportSize.width) {
      x = (viewportSize.width - scaledWidth) / 2
    } else {
      const minX = viewportSize.width - scaledWidth
      x = Math.min(0, Math.max(minX, x))
    }

    if (scaledHeight <= viewportSize.height) {
      y = (viewportSize.height - scaledHeight) / 2
    } else {
      const minY = viewportSize.height - scaledHeight
      y = Math.min(0, Math.max(minY, y))
    }

    return { x, y }
  }

  const applyZoomAt = (requestedZoom, anchorX, anchorY) => {
    const zoom = clampZoom(requestedZoom)
    setView((prev) => {
      const oldScale = baseScale * prev.zoom
      const newScale = baseScale * zoom
      if (!oldScale || !newScale) return prev

      const worldX = (anchorX - prev.x) / oldScale
      const worldY = (anchorY - prev.y) / oldScale
      const rawX = anchorX - worldX * newScale
      const rawY = anchorY - worldY * newScale
      const clamped = clampPan(rawX, rawY, zoom)
      return { zoom, x: clamped.x, y: clamped.y }
    })
  }

  const resetView = () => {
    const clamped = clampPan(0, 0, 1)
    setView({ zoom: 1, x: clamped.x, y: clamped.y })
  }

  const handleSelectRoom = (room) => {
    setCampusId(room.c)
    setFloor(room.f)
    setSelectedRoom(room.n)
    setSearchQuery(room.n)
    setSearchFocused(false)
    searchInputRef.current?.blur()
    if (room.x != null && room.y != null) {
      setHighlightPos({ x: room.x, y: room.y })
    }
  }

  useEffect(() => {
    setImageLoading(true)
    setImageError(false)
    setImageErrorText('')
    setImageSize({ width: 0, height: 0 })
    setLoadedSrc('')
    setView({ zoom: 1, x: 0, y: 0 })
    pointersRef.current.clear()
    dragRef.current = null
    pinchRef.current = null
    setDragging(false)
  }, [imageSrc])

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    const cached = mapMetaCacheRef.current.get(imageSrc)
    if (cached) {
      setImageSize({ width: cached.width, height: cached.height })
      setLoadedSrc(imageSrc)
      setImageLoading(false)
      setImageError(false)
      setImageErrorText('')
      return () => {}
    }

    const loader = new Image()
    loader.decoding = 'async'

    timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setImageLoading(false)
      setImageError(true)
      setImageErrorText('Карта грузится слишком долго. Попробуй повторить.')
    }, 15000)

    loader.onload = () => {
      if (cancelled) return
      if (timeoutId) window.clearTimeout(timeoutId)
      const width = loader.naturalWidth || 0
      const height = loader.naturalHeight || 0
      mapMetaCacheRef.current.set(imageSrc, { width, height })
      setImageSize({ width, height })
      setLoadedSrc(imageSrc)
      setImageLoading(false)
      setImageError(false)
      setImageErrorText('')
    }

    loader.onerror = () => {
      if (cancelled) return
      if (timeoutId) window.clearTimeout(timeoutId)
      setImageLoading(false)
      setImageError(true)
      setImageErrorText('Не удалось загрузить карту. Проверь соединение и попробуй снова.')
    }

    loader.src = imageSrc

    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
      loader.onload = null
      loader.onerror = null
    }
  }, [imageSrc])

  useEffect(() => {
    // Warm up cache for floors of selected campus in background.
    campus.floors.forEach((f) => {
      const src = buildMapSrc(campus.id, f)
      if (src === imageSrc) return
      if (mapMetaCacheRef.current.has(src)) return
      const preload = new Image()
      preload.decoding = 'async'
      preload.onload = () => {
        mapMetaCacheRef.current.set(src, {
          width: preload.naturalWidth || 0,
          height: preload.naturalHeight || 0
        })
      }
      preload.src = src
    })
  }, [campus, imageSrc])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return

    const update = () => {
      const rect = node.getBoundingClientRect()
      setViewportSize({ width: rect.width, height: rect.height })
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!imageSize.width || !imageSize.height || !viewportSize.width || !viewportSize.height) return
    setView((prev) => {
      const clamped = clampPan(prev.x, prev.y, prev.zoom)
      return { ...prev, x: clamped.x, y: clamped.y }
    })
  }, [imageSize.width, imageSize.height, viewportSize.width, viewportSize.height])

  const getViewportPoint = (event) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
  }

  const getPointerDistance = () => {
    const points = Array.from(pointersRef.current.values())
    if (points.length < 2) return 0
    const dx = points[0].x - points[1].x
    const dy = points[0].y - points[1].y
    return Math.hypot(dx, dy)
  }

  const getPointerMidpoint = () => {
    const points = Array.from(pointersRef.current.values())
    if (points.length < 2) return { x: 0, y: 0 }
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    }
  }

  const handlePointerDown = (event) => {
    if (imageLoading || imageError) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size === 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startView: viewRef.current
      }
      setDragging(true)
    } else if (pointersRef.current.size >= 2) {
      dragRef.current = null
      setDragging(false)
      pinchRef.current = {
        distance: getPointerDistance(),
        zoom: viewRef.current.zoom
      }
    }
  }

  const handlePointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2) {
      const pinch = pinchRef.current
      const distance = getPointerDistance()
      if (!pinch || !pinch.distance) {
        pinchRef.current = { distance, zoom: viewRef.current.zoom }
        return
      }
      const ratio = distance / pinch.distance
      const midpoint = getPointerMidpoint()
      const point = getViewportPoint({ clientX: midpoint.x, clientY: midpoint.y })
      applyZoomAt(pinch.zoom * ratio, point.x, point.y)
      return
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const rawX = drag.startView.x + dx
    const rawY = drag.startView.y + dy
    const clamped = clampPan(rawX, rawY, drag.startView.zoom)
    setView({ zoom: drag.startView.zoom, x: clamped.x, y: clamped.y })
  }

  const handlePointerUp = (event) => {
    pointersRef.current.delete(event.pointerId)
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (pointersRef.current.size === 0) {
      dragRef.current = null
      pinchRef.current = null
      setDragging(false)
      return
    }

    if (pointersRef.current.size === 1) {
      const [pointerId, point] = Array.from(pointersRef.current.entries())[0]
      dragRef.current = {
        pointerId,
        startX: point.x,
        startY: point.y,
        startView: viewRef.current
      }
      pinchRef.current = null
      setDragging(true)
    }
  }

  const handleWheel = (event) => {
    if (imageLoading || imageError) return
    event.preventDefault()
    const point = getViewportPoint(event)
    const factor = Math.exp(-event.deltaY * 0.0015)
    applyZoomAt(viewRef.current.zoom * factor, point.x, point.y)
  }

  const zoomIn = () => applyZoomAt(viewRef.current.zoom * 1.25, viewportSize.width / 2, viewportSize.height / 2)
  const zoomOut = () => applyZoomAt(viewRef.current.zoom / 1.25, viewportSize.width / 2, viewportSize.height / 2)
  const retryLoad = () => {
    mapMetaCacheRef.current.delete(imageSrc)
    setImageLoading(true)
    setImageError(false)
    setImageErrorText('')
    setLoadedSrc('')
  }

  return (
    <div className={`maps-section tab-pane ${tabDirection}`}>
      <div className="maps-shell">
        <div className="maps-header">
          <div>
            <h3 className="maps-title">Карты корпусов</h3>
            <p className="maps-subtitle">Быстрая навигация по корпусам и этажам</p>
          </div>
        </div>

        <div className="maps-hero">
          <div className="maps-hero-label">Текущий корпус</div>
          <div className="maps-hero-main">
            <div className="maps-hero-left">
              <div className="maps-hero-name">{campus.shortName}</div>
              <div className="maps-hero-sub">{campus.fullName}</div>
            </div>
            <div className="maps-hero-right">
              <span className="maps-meta-chip">Этаж {floor}</span>
              <span className="maps-meta-chip">{Math.round(view.zoom * 100)}%</span>
            </div>
          </div>
        </div>

        <div className="maps-search">
          <div className="maps-search-field">
            <svg className="maps-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="maps-search-input"
              placeholder="Поиск аудитории..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSelectedRoom(null) }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            />
            {searchQuery && (
              <button type="button" className="maps-search-clear" onClick={handleClearSearch}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchFocused && searchQuery.length >= 2 && !selectedRoom && (
            <div className="maps-search-results">
              {searchResults.length === 0 && (
                <div className="maps-search-empty">Ничего не найдено</div>
              )}
              {searchResults.map(r => (
                <button
                  key={`${r.n}-${r.c}-${r.f}`}
                  type="button"
                  className="maps-search-result"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => handleSelectRoom(r)}
                >
                  <span className="maps-search-result-name">{r.n}</span>
                  <span className="maps-search-result-meta">
                    {CAMPUSES.find(c => c.id === r.c)?.shortName}, этаж {r.f}
                  </span>
                </button>
              ))}
            </div>
          )}
          {selectedRoom && (
            <div className="maps-search-found">
              {selectedRoom} — {campus.shortName}, этаж {floor}
            </div>
          )}
        </div>

        <div className="maps-controls" aria-label="Параметры карты">
          <div className="maps-control-row">
            <span className="maps-control-label">Корпус</span>
            <div className="maps-control-chips" role="tablist" aria-label="Корпус">
              {CAMPUSES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`maps-chip ${campusId === item.id ? 'active' : ''}`}
                  onClick={() => setCampusId(item.id)}
                  title={item.fullName}
                >
                  {item.shortName}
                </button>
              ))}
            </div>
          </div>

          <div className="maps-control-row">
            <span className="maps-control-label">Этаж</span>
            <div className="maps-control-chips" role="tablist" aria-label="Этаж">
              {campus.floors.map((value) => (
                <button
                  key={`${campus.id}-${value}`}
                  type="button"
                  className={`maps-chip maps-floor-chip ${floor === value ? 'active' : ''}`}
                  onClick={() => setFloor(value)}
                >
                  Этаж {value}
                </button>
              ))}
            </div>
          </div>

          <div className="maps-control-row maps-control-row-toolbar">
            <div className="maps-toolbar-inline">
              <button type="button" className="maps-zoom-btn" onClick={zoomOut} disabled={imageLoading || imageError}>
                −
              </button>
              <button type="button" className="maps-zoom-btn" onClick={zoomIn} disabled={imageLoading || imageError}>
                +
              </button>
            </div>
            <button type="button" className="maps-reset-btn" onClick={resetView} disabled={imageLoading || imageError}>
              Сброс
            </button>
          </div>
        </div>

        <div
          ref={viewportRef}
          className={`maps-viewer ${dragging ? 'is-dragging' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          {imageLoading && (
            <div className="maps-placeholder">
              <span>Загрузка карты...</span>
            </div>
          )}
          {imageError && (
            <div className="maps-placeholder maps-placeholder-error">
              <span>{imageErrorText || 'Карта не загрузилась. Попробуй ещё раз.'}</span>
              <button type="button" className="maps-retry-btn" onClick={retryLoad}>
                Повторить
              </button>
            </div>
          )}
          <div
            className={`maps-stage ${imageLoading || imageError ? 'is-hidden' : ''}`}
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${baseScale * view.zoom})`
            }}
          >
            <img
              className="maps-image"
              src={loadedSrc || imageSrc}
              alt={`${campus.fullName}, этаж ${floor}`}
              loading="eager"
              decoding="async"
            />
            {highlightPos && imageSize.width > 0 && (
              <div
                className="maps-room-highlight"
                style={{
                  left: highlightPos.x * imageSize.width,
                  top: highlightPos.y * imageSize.height,
                }}
              />
            )}
          </div>
        </div>

        <p className="maps-gesture-hint">Жесты: двумя пальцами увеличивай, одним пальцем перемещай.</p>
      </div>
    </div>
  )
}
