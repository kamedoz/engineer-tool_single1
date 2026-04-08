import React, { useEffect, useMemo, useRef, useState } from "react";
import { WikiAPI } from "../api.js";

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function ImageUploader({ images, onChange }) {
  const inputRef = useRef();

  async function handleFiles(files) {
    const next = [...images];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 3 * 1024 * 1024) continue;
      const b64 = await toBase64(file);
      next.push(b64);
    }
    onChange(next);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(Array.from(e.dataTransfer.files || []));
        }}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: "2px dashed var(--border)",
          borderRadius: 12,
          padding: 14,
          textAlign: "center",
          cursor: "pointer",
          opacity: 0.8,
        }}
      >
        Drop article images here or click to upload
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(Array.from(e.target.files || []))}
      />

      {images.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {images.map((src, idx) => (
            <div key={idx} style={{ position: "relative" }}>
              <img
                src={src}
                alt=""
                style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }}
              />
              <button
                onClick={() => onChange(images.filter((_, imageIdx) => imageIdx !== idx))}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  padding: 0,
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArticleForm({ initial, categories, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [category, setCategory] = useState(initial?.category || "");
  const [body, setBody] = useState(initial?.body || "");
  const [images, setImages] = useState(Array.isArray(initial?.images) ? initial.images : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const nextTitle = title.trim();
    const nextCategory = category.trim();
    if (!nextTitle) return setError("Title is required");
    if (!nextCategory) return setError("Category is required");

    setSaving(true);
    setError("");
    try {
      await onSave({ title: nextTitle, category: nextCategory, body, images });
    } catch (e) {
      setError(e?.message || "Failed to save article");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article title" />
      <input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Category"
        list="wiki-categories"
      />
      <datalist id="wiki-categories">
        {categories.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write article details here..."
        style={{ minHeight: 180 }}
      />
      <ImageUploader images={images} onChange={setImages} />
      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={submit} disabled={saving}>
          {saving ? "Saving..." : "Save article"}
        </button>
      </div>
    </div>
  );
}

function AuthorBadge({ author }) {
  if (!author) return <span>Unknown author</span>;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--card2)",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {author.avatar_url ? (
          <img src={author.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span>{author.display_name?.slice(0, 1)?.toUpperCase() || "U"}</span>
        )}
      </div>
      <span style={{ color: author.nickname_color || "#e5e7eb", fontWeight: 700 }}>
        {author.badge_icon ? `${author.badge_icon} ` : ""}
        {author.display_name}
      </span>
      <span style={{ opacity: 0.7, fontSize: 12 }}>Level {author.level}</span>
    </div>
  );
}

function ArticleCard({ article, canEdit, canDelete, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div
        onClick={() => setExpanded((value) => !value)}
        style={{ padding: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{article.title}</div>
          <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                background: "rgba(79,124,255,.18)",
                borderRadius: 999,
                padding: "2px 10px",
                border: "1px solid rgba(79,124,255,.3)",
                fontSize: 12,
              }}
            >
              {article.category}
            </span>
            <AuthorBadge author={article.author} />
          </div>
        </div>
        <div style={{ opacity: 0.7 }}>{expanded ? "▲" : "▼"}</div>
      </div>

      {expanded ? (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
          {article.body ? (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, wordBreak: "break-word" }}>{article.body}</div>
          ) : null}

          {article.images?.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {article.images.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt=""
                  style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }}
                />
              ))}
            </div>
          ) : null}

          {(canEdit || canDelete) ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {canEdit ? <button onClick={() => onEdit(article)}>Edit</button> : null}
              {canDelete ? (
                <button onClick={() => onDelete(article)} style={{ background: "rgba(184,74,90,.18)", borderColor: "rgba(184,74,90,.35)" }}>
                  Delete
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function WikiSection({ me, onMeRefresh }) {
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null);

  const currentUser = me?.user;
  const canEdit = Boolean(currentUser?.role === "admin" || currentUser?.can_edit_wiki);
  const canDelete = Boolean(currentUser?.role === "admin" || currentUser?.can_delete_wiki);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [arts, cats] = await Promise.all([WikiAPI.list(), WikiAPI.categories()]);
      setArticles(arts || []);
      setCategories(cats || []);
    } catch (e) {
      setError(e?.message || "Failed to load wiki");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(payload) {
    if (mode === "new") {
      await WikiAPI.create(payload);
      await onMeRefresh?.();
    } else {
      await WikiAPI.update(mode.id, payload);
    }
    setMode(null);
    await load();
  }

  async function handleDelete(article) {
    if (!confirm(`Delete "${article.title}"?`)) return;
    try {
      await WikiAPI.remove(article.id);
      await load();
    } catch (e) {
      setError(e?.message || "Failed to delete article");
    }
  }

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return articles.filter((article) => {
      if (categoryFilter && article.category !== categoryFilter) return false;
      if (!query) return true;
      return (
        (article.title || "").toLowerCase().includes(query) ||
        (article.category || "").toLowerCase().includes(query) ||
        (article.body || "").toLowerCase().includes(query)
      );
    });
  }, [articles, search, categoryFilter]);

  if (mode !== null) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setMode(null)}>Back</button>
          <h2 style={{ margin: 0 }}>{mode === "new" ? "New article" : "Edit article"}</h2>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Knowledge base</h2>
          <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
            Everyone can add articles. Editing and deleting are restricted by admin permissions.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load}>Refresh</button>
          <button onClick={() => setMode("new")}>+ Add article</button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles..."
            style={{ flex: 1, minWidth: 180 }}
          />
        </div>
      </div>

      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.7 }}>Loading...</div> : null}

      {!loading && visible.length === 0 ? (
        <div style={{ opacity: 0.75 }}>{articles.length === 0 ? "No articles yet." : "Nothing found."}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visible.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={(item) => setMode(item)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
