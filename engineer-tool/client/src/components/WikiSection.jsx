import React, { useEffect, useRef, useState, useMemo } from "react";
import { WikiAPI } from "../api.js";

/* ── Image helpers ── */
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ── ImageUploader ── */
function ImageUploader({ images, onChange }) {
  const inputRef = useRef();

  async function handleFiles(files) {
    const next = [...images];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 3 * 1024 * 1024) { alert(`Файл ${f.name} > 3 МБ, пропускаем`); continue; }
      const b64 = await toBase64(f);
      next.push(b64);
    }
    onChange(next);
  }

  function onDrop(e) {
    e.preventDefault();
    handleFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        style={{
          border: "2px dashed var(--border)",
          borderRadius: 12,
          padding: "16px 12px",
          textAlign: "center",
          cursor: "pointer",
          fontSize: 13,
          opacity: 0.8,
          marginBottom: 8,
          transition: "border-color .15s",
        }}
      >
        📎 Перетащи или нажми для загрузки фото (до 3 МБ каждое)
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(Array.from(e.target.files))}
        />
      </div>

      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {images.map((src, idx) => (
            <div key={idx} style={{ position: "relative" }}>
              <img
                src={src}
                alt=""
                style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }}
              />
              <button
                onClick={() => onChange(images.filter((_, i) => i !== idx))}
                style={{
                  position: "absolute", top: -6, right: -6,
                  width: 22, height: 22, borderRadius: "50%",
                  padding: 0, fontSize: 12, lineHeight: 1,
                  background: "rgba(200,40,40,.85)", border: "none",
                  color: "#fff", cursor: "pointer",
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── ArticleForm ── */
function ArticleForm({ initial, categories, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [category, setCategory] = useState(initial?.category || "");
  const [categoryInput, setCategoryInput] = useState(initial?.category || "");
  const [body, setBody] = useState(initial?.body || "");
  const [images, setImages] = useState(() => {
    if (!initial?.images) return [];
    if (typeof initial.images === "string") {
      try { return JSON.parse(initial.images); } catch { return []; }
    }
    return initial.images;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Если выбрали из списка — подставляем в input
  function handleCategorySelect(e) {
    setCategory(e.target.value);
    setCategoryInput(e.target.value);
  }

  async function submit() {
    const t = title.trim();
    const cat = (categoryInput || category).trim();
    if (!t) { setError("Укажи название"); return; }
    if (!cat) { setError("Укажи категорию"); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({ title: t, category: cat, body, images });
    } catch (e) {
      setError(e?.message || "Ошибка сохранения");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label style={{ fontSize: 12, opacity: 0.75 }}>Название *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название статьи" style={{ marginTop: 4 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, opacity: 0.75 }}>Категория *</label>
          <input
            value={categoryInput}
            onChange={(e) => { setCategoryInput(e.target.value); setCategory(e.target.value); }}
            placeholder="Введи или выбери ниже"
            list="wiki-cats"
            style={{ marginTop: 4 }}
          />
          <datalist id="wiki-cats">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>

      <div>
        <label style={{ fontSize: 12, opacity: 0.75 }}>Текст</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Опиши знание, инструкцию, наблюдение…"
          style={{ marginTop: 4, minHeight: 140 }}
        />
      </div>

      <ImageUploader images={images} onChange={setImages} />

      {error && <div style={{ color: "#ff6b7a", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button onClick={onCancel}>Отмена</button>
        <button onClick={submit} disabled={saving} style={{ background: "rgba(79,124,255,.22)", borderColor: "rgba(79,124,255,.35)" }}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

/* ── ArticleCard ── */
function ArticleCard({ article, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const images = useMemo(() => {
    if (!article.images) return [];
    if (typeof article.images === "string") {
      try { return JSON.parse(article.images); } catch { return []; }
    }
    return article.images;
  }, [article.images]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 10 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{article.title}</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
            <span style={{
              background: "rgba(79,124,255,.18)",
              borderRadius: 6,
              padding: "2px 8px",
              border: "1px solid rgba(79,124,255,.3)",
            }}>
              {article.category}
            </span>
            {images.length > 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>📷 {images.length}</span>}
          </div>
        </div>
        <div style={{ flexShrink: 0, opacity: 0.6, fontSize: 18 }}>{expanded ? "▲" : "▼"}</div>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          {article.body && (
            <div style={{ whiteSpace: "pre-wrap", opacity: 0.92, lineHeight: 1.6, wordBreak: "break-word", marginBottom: images.length ? 12 : 0 }}>
              {article.body}
            </div>
          )}

          {images.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {images.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt=""
                  onClick={() => setLightbox(src)}
                  style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)", cursor: "zoom-in" }}
                />
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => onEdit(article)} style={{ fontSize: 13, padding: "6px 12px" }}>Редактировать</button>
            <button onClick={() => onDelete(article)} style={{ fontSize: 13, padding: "6px 12px", background: "rgba(184,74,90,.18)", borderColor: "rgba(184,74,90,.35)" }}>Удалить</button>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

/* ════════════════════════
   MAIN WikiSection
   ════════════════════════ */
export default function WikiSection() {
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // "new" | article-object (edit) | null (list)
  const [mode, setMode] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [arts, cats] = await Promise.all([WikiAPI.list(), WikiAPI.categories()]);
      setArticles(arts || []);
      setCategories(cats || []);
    } catch (e) {
      setError(e?.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(payload) {
    if (mode === "new") {
      await WikiAPI.create(payload);
    } else {
      await WikiAPI.update(mode.id, payload);
    }
    setMode(null);
    await load();
  }

  async function handleDelete(article) {
    if (!confirm(`Удалить "${article.title}"?`)) return;
    try {
      await WikiAPI.remove(article.id);
      await load();
    } catch (e) {
      setError(e?.message || "Ошибка удаления");
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
      if (categoryFilter && a.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        (a.title || "").toLowerCase().includes(q) ||
        (a.category || "").toLowerCase().includes(q) ||
        (a.body || "").toLowerCase().includes(q)
      );
    });
  }, [articles, search, categoryFilter]);

  /* ── Render ── */
  if (mode !== null) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setMode(null)} style={{ padding: "6px 12px" }}>← Назад</button>
          <h2 style={{ margin: 0 }}>{mode === "new" ? "Новая статья" : "Редактировать"}</h2>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
          <ArticleForm
            initial={mode === "new" ? null : mode}
            categories={categories}
            onSave={handleSave}
            onCancel={() => setMode(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>📚 Библиотека знаний</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "8px 12px" }}>↻</button>
          <button
            onClick={() => setMode("new")}
            style={{ padding: "8px 14px", background: "rgba(79,124,255,.22)", borderColor: "rgba(79,124,255,.35)", fontWeight: 600 }}
          >
            + Добавить статью
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Все категории</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, категории, тексту…"
            style={{ flex: 1, minWidth: 160 }}
          />
          {(search || categoryFilter) && (
            <button onClick={() => { setSearch(""); setCategoryFilter(""); }} style={{ padding: "8px 12px", opacity: 0.7 }}>
              ✕ Сброс
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && <div style={{ color: "#ff6b7a", fontSize: 13 }}>{error}</div>}

      {/* Articles */}
      {loading ? (
        <div style={{ opacity: 0.7, padding: 8 }}>Загрузка…</div>
      ) : visible.length === 0 ? (
        <div style={{ opacity: 0.75, padding: 8 }}>
          {articles.length === 0 ? "Библиотека пуста. Добавь первую статью!" : "Ничего не найдено."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visible.map((a) => (
            <ArticleCard
              key={a.id}
              article={a}
              onEdit={(art) => setMode(art)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
