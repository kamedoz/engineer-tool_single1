import React, { useEffect, useMemo, useRef, useState } from "react";
import { WikiAPI } from "../api.js";
import WikiEditor, { ArticleBody } from "./WikiEditor.jsx";

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function isVideoSrc(src) {
  return String(src || "").startsWith("data:video/");
}

function MediaUploader({ items, onChange }) {
  const inputRef = useRef();

  async function handleFiles(files) {
    const next = [...items];
    for (const file of files) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) continue;
      if (file.size > 20 * 1024 * 1024) continue;
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
        Drop article photos or videos here or click to upload
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(Array.from(e.target.files || []))}
      />

      {items.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {items.map((src, idx) => (
            <div key={idx} style={{ position: "relative" }}>
              {isVideoSrc(src) ? (
                <video src={src} muted playsInline style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)", background: "#020617" }} />
              ) : (
                <img src={src} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} />
              )}
              <button
                onClick={() => onChange(items.filter((_, imageIdx) => imageIdx !== idx))}
                style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", padding: 0 }}
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

function ArticleForm({ initial, categories, onSave, onCancel, t }) {
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
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("articleTitle")} />
      <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("categoryRequired")} list="wiki-categories" />
      <datalist id="wiki-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
      <WikiEditor value={body} onChange={setBody} />
      <MediaUploader items={images} onChange={setImages} />
      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel}>{t("cancel")}</button>
        <button onClick={submit} disabled={saving}>{saving ? t("loading") : t("save")}</button>
      </div>
    </div>
  );
}

function AuthorBadge({ author }) {
  if (!author) return <span>Unknown author</span>;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", border: "1px solid var(--border)", background: "var(--card2)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>
        {author.avatar_url ? <img src={author.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span>{author.display_name?.slice(0, 1)?.toUpperCase() || "U"}</span>}
      </div>
      <span style={{ color: author.nickname_color || "#e5e7eb", fontWeight: 700 }}>
        {author.badge_icon ? `${author.badge_icon} ` : ""}
        {author.display_name}
      </span>
      <span style={{ opacity: 0.7, fontSize: 12 }}>Level {author.level}</span>
    </div>
  );
}

function CommentComposer({ onSubmit, initial = "", onCancel, submitLabel = "Save", t }) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <textarea value={value} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 70 }} placeholder={t("writeComment")} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onCancel ? <button onClick={onCancel}>{t("cancel")}</button> : null}
        <button onClick={() => onSubmit(value)}>{submitLabel}</button>
      </div>
    </div>
  );
}

function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 8, 20, 0.88)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        zIndex: 1000,
      }}
    >
      {isVideoSrc(src) ? (
        <video
          src={src}
          controls
          autoPlay
          onClick={(event) => event.stopPropagation()}
          style={{
            maxWidth: "min(1100px, 100%)",
            maxHeight: "calc(100vh - 48px)",
            borderRadius: 16,
            border: "1px solid var(--border)",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
            background: "#020617",
          }}
        />
      ) : (
        <img
          src={src}
          alt=""
          onClick={(event) => event.stopPropagation()}
          style={{
            maxWidth: "min(1100px, 100%)",
            maxHeight: "calc(100vh - 48px)",
            borderRadius: 16,
            border: "1px solid var(--border)",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
            objectFit: "contain",
            background: "rgba(255,255,255,0.02)",
          }}
        />
      )}
    </div>
  );
}

function CommentsSection({ article, me, onError, t }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState("");

  async function loadComments() {
    setLoading(true);
    try {
      const data = await WikiAPI.comments(article.id);
      setComments(data || []);
    } catch (e) {
      onError?.(e?.message || "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadComments();
  }, [article.id]);

  async function addComment(body) {
    const text = String(body || "").trim();
    if (!text) return;
    try {
      const created = await WikiAPI.addComment(article.id, text);
      setComments((prev) => [...prev, created]);
    } catch (e) {
      onError?.(e?.message || "Failed to add comment");
    }
  }

  async function saveComment(commentId, body) {
    const text = String(body || "").trim();
    if (!text) return;
    try {
      const updated = await WikiAPI.updateComment(article.id, commentId, text);
      setComments((prev) => prev.map((item) => (item.id === commentId ? updated : item)));
      setEditingId("");
    } catch (e) {
      onError?.(e?.message || "Failed to update comment");
    }
  }

  async function deleteComment(commentId) {
    if (!confirm("Delete this comment?")) return;
    try {
      await WikiAPI.removeComment(article.id, commentId);
      setComments((prev) => prev.filter((item) => item.id !== commentId));
    } catch (e) {
      onError?.(e?.message || "Failed to delete comment");
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 700 }}>{t("comments")}</div>
      <CommentComposer onSubmit={addComment} submitLabel={t("addComment")} t={t} />
      {loading ? <div style={{ opacity: 0.7 }}>Loading comments...</div> : null}
      {comments.map((comment) => {
        const canManage = comment.user_id === me?.user?.id || me?.user?.role === "admin";
        return (
          <div key={comment.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <AuthorBadge author={comment.author} />
              <div style={{ opacity: 0.65, fontSize: 12 }}>
                {new Date(comment.created_at).toLocaleString()}{comment.updated_at ? " · edited" : ""}
              </div>
            </div>
            {editingId === comment.id ? (
              <div style={{ marginTop: 8 }}>
                <CommentComposer
                  initial={comment.body}
                  onSubmit={(body) => saveComment(comment.id, body)}
                  onCancel={() => setEditingId("")}
                  submitLabel={t("save")}
                  t={t}
                />
              </div>
            ) : (
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: comment.is_deleted ? 0.6 : 1 }}>{comment.body}</div>
            )}
            {canManage && !comment.is_deleted && editingId !== comment.id ? (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setEditingId(comment.id)}>{t("edit")}</button>
                <button onClick={() => deleteComment(comment.id)}>{t("delete")}</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ArticleCard({ article, me, canEdit, canDelete, onEdit, onDelete, onQuote, onError, t }) {
  const [expanded, setExpanded] = useState(false);
  const [openImage, setOpenImage] = useState("");

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div onClick={() => setExpanded((value) => !value)} style={{ padding: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{article.title}</div>
          <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ background: "rgba(79,124,255,.18)", borderRadius: 999, padding: "2px 10px", border: "1px solid rgba(79,124,255,.3)", fontSize: 12 }}>
              {article.category}
            </span>
            <AuthorBadge author={article.author} />
          </div>
        </div>
        <div style={{ opacity: 0.7 }}>{expanded ? "▲" : "▼"}</div>
      </div>

      {expanded ? (
        <div
          style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}
          onWikiImgClick={(e) => setOpenImage(e.detail?.src)}
          ref={(el) => {
            if (!el) return;
            el.onwikiimgclick = undefined;
            el.addEventListener("wiki-img-click", (e) => setOpenImage(e.detail?.src));
          }}
        >
          {article.body ? <ArticleBody body={article.body} /> : null}
          {article.images?.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {article.images.map((src, idx) => (
                isVideoSrc(src) ? (
                  <video
                    key={idx}
                    src={src}
                    muted
                    playsInline
                    onClick={() => setOpenImage(src)}
                    style={{
                      width: 160,
                      height: 110,
                      objectFit: "cover",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      background: "#020617",
                    }}
                  />
                ) : (
                  <img
                    key={idx}
                    src={src}
                    alt=""
                    onClick={() => setOpenImage(src)}
                    style={{
                      width: 110,
                      height: 110,
                      objectFit: "cover",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      cursor: "zoom-in",
                    }}
                  />
                )
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={() => onQuote(article)}>{t("quoteToChat")}</button>
            {canEdit ? <button onClick={() => onEdit(article)}>{t("edit")}</button> : null}
            {canDelete ? <button onClick={() => onDelete(article)} style={{ background: "rgba(184,74,90,.18)", borderColor: "rgba(184,74,90,.35)" }}>{t("delete")}</button> : null}
          </div>

          <CommentsSection article={article} me={me} onError={onError} t={t} />
        </div>
      ) : null}
      {openImage ? <ImageLightbox src={openImage} onClose={() => setOpenImage("")} /> : null}
    </div>
  );
}

export default function WikiSection({ me, onMeRefresh, onQuoteArticle, t }) {
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
          <h2 style={{ margin: 0 }}>{mode === "new" ? t("newArticle") : t("editArticle")}</h2>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
          <ArticleForm initial={mode === "new" ? null : mode} categories={categories} onSave={handleSave} onCancel={() => setMode(null)} t={t} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{t("knowledgeBase")}</h2>
          <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
            {t("knowledgeIntro")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load}>{t("refresh")}</button>
          <button onClick={() => setMode("new")}>+ {t("addArticle")}</button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">{t("allCategories")}</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("globalSearchPlaceholder")} style={{ flex: 1, minWidth: 180 }} />
        </div>
      </div>

      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.7 }}>Loading...</div> : null}

      {!loading && visible.length === 0 ? (
        <div style={{ opacity: 0.75 }}>{articles.length === 0 ? t("noArticlesYet") : t("nothingFound")}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visible.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              me={me}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={(item) => setMode(item)}
              onDelete={handleDelete}
              onQuote={onQuoteArticle}
              onError={setError}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}
