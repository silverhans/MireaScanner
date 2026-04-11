import { useState, useEffect, useRef, useMemo } from 'react'
import { formatMoscowDate, getLocalDayKey } from '../utils'

const tg = window.Telegram?.WebApp

export default function useSchedule({ isAuthorized }) {
  const [groupName, setGroupName] = useState(() => {
    try {
      return localStorage.getItem('schedule_group') || ''
    } catch (e) {
      return ''
    }
  })
  const [scheduleEvents, setScheduleEvents] = useState([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState('')
  const [scheduleAttempted, setScheduleAttempted] = useState(false)
  const [scheduleRaw, setScheduleRaw] = useState(null)
  const [scheduleResolvedGroup, setScheduleResolvedGroup] = useState('')
  const [scheduleEntity, setScheduleEntity] = useState(null)

  const [scheduleTabMode, setScheduleTabMode] = useState('group')
  const [scheduleTeacherQuery, setScheduleTeacherQuery] = useState('')
  const [scheduleClassroomQuery, setScheduleClassroomQuery] = useState('')
  const [groupSuggestions, setGroupSuggestions] = useState([])
  const [teacherSuggestions, setTeacherSuggestions] = useState([])
  const [classroomSuggestions, setClassroomSuggestions] = useState([])

  const [exploreScheduleEvents, setExploreScheduleEvents] = useState([])
  const [exploreScheduleLoading, setExploreScheduleLoading] = useState(false)
  const [exploreScheduleError, setExploreScheduleError] = useState('')
  const [exploreScheduleRaw, setExploreScheduleRaw] = useState(null)
  const [exploreScheduleEntity, setExploreScheduleEntity] = useState(null)

  const [scheduleViewMode, setScheduleViewMode] = useState('day')
  const [scheduleFocusDate, setScheduleFocusDate] = useState(() => new Date())

  const initialLoadDoneRef = useRef(false)

  // Init from localStorage
  useEffect(() => {
    const savedScheduleMode = localStorage.getItem('schedule_tab_mode')
    if (savedScheduleMode === 'teacher' || savedScheduleMode === 'classroom' || savedScheduleMode === 'group') {
      setScheduleTabMode(savedScheduleMode)
    }
    const savedTeacher = localStorage.getItem('schedule_teacher')
    if (savedTeacher) setScheduleTeacherQuery(savedTeacher)
    const savedClassroom = localStorage.getItem('schedule_classroom')
    if (savedClassroom) setScheduleClassroomQuery(savedClassroom)
  }, [])

  // Auto-load schedule once on first auth: try Pulse first, fallback to saved group
  useEffect(() => {
    if (!isAuthorized) return
    if (initialLoadDoneRef.current) return
    initialLoadDoneRef.current = true
    if (scheduleLoading || scheduleEvents.length > 0) return

    const autoLoad = async () => {
      // Try Pulse (personal schedule via gRPC, no group input needed)
      setScheduleLoading(true)
      setScheduleError('')
      try {
        const response = await fetch('/api/schedule/pulse?days=7', {
          headers: { 'X-Telegram-Init-Data': tg?.initData || '' }
        })
        const data = await response.json()
        if (data.success && data.events && data.events.length > 0) {
          setScheduleEvents(data.events)
          setScheduleEntity({ type: 'pulse', name: 'Моё расписание' })
          setScheduleResolvedGroup('Моё расписание')
          setScheduleFocusDate(new Date())
          setScheduleViewMode('day')
          setScheduleAttempted(true)
          setScheduleLoading(false)
          return
        }
      } catch (err) {}
      setScheduleLoading(false)

      // Fallback: load saved group
      const groupToLoad = (groupName || '').trim()
      if (groupToLoad) {
        setScheduleAttempted(true)
        loadGroupSchedule({ query: groupToLoad })
      }
    }

    autoLoad()
  }, [isAuthorized])

  // Save schedule tab mode
  useEffect(() => {
    localStorage.setItem('schedule_tab_mode', scheduleTabMode)
    setGroupSuggestions([])
    setTeacherSuggestions([])
    setClassroomSuggestions([])
  }, [scheduleTabMode])

  // Group search debounce
  useEffect(() => {
    if (scheduleTabMode !== 'group') return
    const query = (groupName || '').trim().toUpperCase()
    if (query.length < 2) { setGroupSuggestions([]); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query })
        const response = await fetch(`/api/groups/search?${params.toString()}`, {
          headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
          signal: controller.signal
        })
        if (!response.ok) return
        const data = await response.json()
        if (data.success) setGroupSuggestions(data.groups || [])
      } catch (err) {}
    }, 240)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [scheduleTabMode, groupName])

  // Teacher search debounce
  useEffect(() => {
    if (scheduleTabMode !== 'teacher') return
    const query = (scheduleTeacherQuery || '').trim()
    if (query.length < 2) { setTeacherSuggestions([]); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query })
        const response = await fetch(`/api/teachers/search?${params.toString()}`, {
          headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
          signal: controller.signal
        })
        if (!response.ok) return
        const data = await response.json()
        if (data.success) setTeacherSuggestions(data.teachers || [])
      } catch (err) {}
    }, 260)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [scheduleTabMode, scheduleTeacherQuery])

  // Classroom search debounce
  useEffect(() => {
    if (scheduleTabMode !== 'classroom') return
    const query = (scheduleClassroomQuery || '').trim()
    if (query.length < 1) { setClassroomSuggestions([]); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query })
        const response = await fetch(`/api/classrooms/search?${params.toString()}`, {
          headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
          signal: controller.signal
        })
        if (!response.ok) return
        const data = await response.json()
        if (data.success) setClassroomSuggestions(data.classrooms || [])
      } catch (err) {}
    }, 260)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [scheduleTabMode, scheduleClassroomQuery])

  // --- Actions ---

  const clearGroupSchedule = () => {
    setGroupName(''); setGroupSuggestions([]); setScheduleEvents([]); setScheduleRaw(null)
    setScheduleError(''); setScheduleResolvedGroup(''); setScheduleEntity(null); setScheduleAttempted(false)
    localStorage.removeItem('schedule_group')
  }

  const clearTeacherSchedule = () => {
    setScheduleTeacherQuery(''); setTeacherSuggestions([]); setExploreScheduleEvents([])
    setExploreScheduleRaw(null); setExploreScheduleError(''); setExploreScheduleEntity(null)
    localStorage.removeItem('schedule_teacher')
  }

  const clearClassroomSchedule = () => {
    setScheduleClassroomQuery(''); setClassroomSuggestions([]); setExploreScheduleEvents([])
    setExploreScheduleRaw(null); setExploreScheduleError(''); setExploreScheduleEntity(null)
    localStorage.removeItem('schedule_classroom')
  }

  const loadGroupSchedule = async ({ query, uid } = {}) => {
    const rawValue = (query ?? groupName).trim().toUpperCase()
    if (!uid && !rawValue) { setScheduleError('Введи название группы (например ХББО-02-25)'); return }
    setScheduleLoading(true); setScheduleError(''); setScheduleRaw(null); setScheduleEntity(null)
    try {
      const params = new URLSearchParams({ type: 'group' })
      if (uid) params.set('uid', String(uid))
      if (rawValue) params.set('group', rawValue)
      const response = await fetch(`/api/schedule?${params.toString()}`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } })
      const data = await response.json()
      if (data.success) {
        const resolved = data.entity?.name || data.group || rawValue
        setScheduleEvents(data.events || []); setScheduleRaw(data.raw || null)
        setScheduleResolvedGroup(resolved); setScheduleEntity(data.entity || null)
        setScheduleFocusDate(new Date()); setScheduleViewMode('day')
        if (resolved) setGroupName(String(resolved).toUpperCase())
        localStorage.setItem('schedule_group', rawValue || String(resolved || '').toUpperCase())
      } else {
        setScheduleError(data.message || 'Ошибка загрузки расписания')
      }
    } catch (err) {
      setScheduleError('Ошибка соединения')
    } finally {
      setScheduleLoading(false)
    }
  }

  const loadExploreSchedule = async ({ type, uid, name, campus } = {}) => {
    const kind = type || scheduleTabMode
    if (kind !== 'teacher' && kind !== 'classroom') return
    const queryValue = kind === 'teacher' ? scheduleTeacherQuery : scheduleClassroomQuery
    const rawQuery = (name ?? queryValue).trim()
    if (!uid && !rawQuery) { setExploreScheduleError(kind === 'teacher' ? 'Введи преподавателя' : 'Введи аудиторию'); return }
    setExploreScheduleLoading(true); setExploreScheduleError(''); setExploreScheduleRaw(null); setExploreScheduleEntity(null)
    try {
      const params = new URLSearchParams({ type: kind })
      if (uid) params.set('uid', String(uid))
      if (rawQuery) params.set('q', rawQuery)
      const response = await fetch(`/api/schedule?${params.toString()}`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } })
      const data = await response.json()
      if (data.success) {
        setExploreScheduleEvents(data.events || []); setExploreScheduleRaw(data.raw || null)
        const entity = data.entity || { type: kind, uid: uid ? String(uid) : null, name: rawQuery || null, campus: campus || null }
        setExploreScheduleEntity(entity); setScheduleFocusDate(new Date()); setScheduleViewMode('day')
        if (kind === 'teacher') localStorage.setItem('schedule_teacher', rawQuery)
        else localStorage.setItem('schedule_classroom', rawQuery)
        localStorage.setItem('schedule_tab_mode', kind)
      } else {
        setExploreScheduleError(data.message || 'Ошибка загрузки расписания')
      }
    } catch (err) {
      setExploreScheduleError('Ошибка соединения')
    } finally {
      setExploreScheduleLoading(false)
    }
  }

  const shiftScheduleFocus = (deltaDays) => {
    setScheduleFocusDate((prev) => {
      const d = new Date(prev)
      if (Number.isNaN(d.getTime())) return new Date()
      d.setDate(d.getDate() + deltaDays)
      return d
    })
  }

  const reset = () => {
    setGroupName(''); setScheduleEvents([]); setScheduleRaw(null)
    setScheduleError(''); setScheduleAttempted(false)
    localStorage.removeItem('schedule_group')
  }

  // --- Computed ---

  const scheduleTabEvents = scheduleTabMode === 'group' ? scheduleEvents : exploreScheduleEvents
  const scheduleTabLoading = scheduleTabMode === 'group' ? scheduleLoading : exploreScheduleLoading
  const scheduleTabError = scheduleTabMode === 'group' ? scheduleError : exploreScheduleError
  const scheduleTabRaw = scheduleTabMode === 'group' ? scheduleRaw : exploreScheduleRaw
  const scheduleTabEntity = scheduleTabMode === 'group' ? scheduleEntity : exploreScheduleEntity
  const scheduleTabResolvedName = scheduleTabEntity?.name || (scheduleTabMode === 'group' ? scheduleResolvedGroup : '') || ''

  const scheduleParsed = useMemo(() => {
    return (scheduleTabEvents || [])
      .map((event) => {
        const start = new Date(event.start)
        if (Number.isNaN(start.getTime())) return null
        const end = event.end ? new Date(event.end) : null
        const dayKey = getLocalDayKey(start)
        return { ...event, _start: start, _end: end, _dayKey: dayKey }
      })
      .filter(Boolean)
      .sort((a, b) => a._start - b._start)
  }, [scheduleTabEvents])

  const scheduleByDayKey = useMemo(() => {
    const map = {}
    for (const event of scheduleParsed) {
      const key = event._dayKey || getLocalDayKey(event._start)
      if (!key) continue
      if (!map[key]) map[key] = []
      map[key].push(event)
    }
    return map
  }, [scheduleParsed])

  const scheduleDisplayKeys = useMemo(() => {
    const focus = new Date(scheduleFocusDate)
    if (Number.isNaN(focus.getTime())) return []
    focus.setHours(0, 0, 0, 0)
    if (scheduleViewMode === 'day') return [getLocalDayKey(focus)]
    const start = new Date(focus)
    const dayIndex = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - dayIndex)
    const keys = []
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      keys.push(getLocalDayKey(d))
    }
    return keys
  }, [scheduleFocusDate, scheduleViewMode])

  const formatScheduleRange = useMemo(() => {
    const focus = new Date(scheduleFocusDate)
    if (Number.isNaN(focus.getTime())) return ''
    const baseOpts = { day: '2-digit', month: 'short' }
    if (scheduleViewMode === 'day') return formatMoscowDate(focus, { weekday: 'short', ...baseOpts })
    const start = new Date(focus)
    start.setHours(0, 0, 0, 0)
    const dayIndex = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - dayIndex)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return `${formatMoscowDate(start, baseOpts)}–${formatMoscowDate(end, baseOpts)}`
  }, [scheduleFocusDate, scheduleViewMode])

  const todaySchedule = useMemo(() => {
    if (!scheduleEvents || scheduleEvents.length === 0) return { events: [], next: null }
    const todayKey = getLocalDayKey(new Date())
    const now = new Date()
    const events = scheduleEvents
      .map((event) => {
        const start = new Date(event.start)
        if (Number.isNaN(start.getTime())) return null
        const end = event.end ? new Date(event.end) : null
        return { ...event, _start: start, _end: end, _dayKey: getLocalDayKey(start) }
      })
      .filter(Boolean)
      .filter((event) => event._dayKey === todayKey)
      .sort((a, b) => a._start - b._start)
    const next = events.find((event) => event._start >= now) || events[0] || null
    return { events, next }
  }, [scheduleEvents])

  return {
    // State
    groupName, setGroupName, scheduleTabMode, setScheduleTabMode,
    scheduleTeacherQuery, setScheduleTeacherQuery,
    scheduleClassroomQuery, setScheduleClassroomQuery,
    groupSuggestions, setGroupSuggestions,
    teacherSuggestions, setTeacherSuggestions,
    classroomSuggestions, setClassroomSuggestions,
    scheduleViewMode, setScheduleViewMode,
    scheduleFocusDate, setScheduleFocusDate,
    scheduleEvents, scheduleLoading, scheduleError, scheduleAttempted, setScheduleAttempted,
    // Computed
    scheduleTabEvents, scheduleTabLoading, scheduleTabError,
    scheduleTabRaw, scheduleTabEntity, scheduleTabResolvedName,
    scheduleByDayKey, scheduleDisplayKeys,
    formatScheduleRange, todaySchedule,
    // Actions
    loadGroupSchedule, loadExploreSchedule,
    clearGroupSchedule, clearTeacherSchedule, clearClassroomSchedule,
    shiftScheduleFocus, reset
  }
}
