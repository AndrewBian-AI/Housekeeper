import { useState, useEffect } from "react";
import { api } from "@/api/client";
import type { Category } from "@caiwu/shared";
import { Plus, Edit2, Archive, RotateCcw } from "lucide-react";

const TYPE_LABELS: Record<string, string> = { expense: "支出", income: "收入" };

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "expense", icon: "", color: "#3b82f6" });

  useEffect(() => { loadData(); }, [filterType]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = filterType ? `?type=${filterType}` : "";
      setCategories(await api.get<Category[]>(`/categories${params}`));
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      await api.put(`/categories/${editingId}`, form);
    } else {
      await api.post("/categories", form);
    }
    setShowForm(false);
    setEditingId(null);
    setForm({ name: "", type: "expense", icon: "", color: "#3b82f6" });
    loadData();
  };

  const handleEdit = (c: Category) => {
    setEditingId(c.id);
    setForm({ name: c.name, type: c.type, icon: c.icon || "", color: c.color || "#3b82f6" });
    setShowForm(true);
  };

  const toggleActive = async (c: Category) => {
    if (c.isActive && !confirm(`确定归档“${c.name}”分类吗？历史记账和预算不会受影响。`)) return;
    await api.put(`/categories/${c.id}`, { isActive: !c.isActive });
    loadData();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">分类管理</h2>
          <p className="mt-1 text-sm text-muted-foreground">分类归档后不再用于新记账，但历史记录和预算关联会继续保留。</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: "", type: "expense", icon: "", color: "#3b82f6" }); }}
          className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm">
          <Plus className="h-4 w-4" /> 新增分类
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {["", "expense", "income"].map((t) => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`px-3 py-1 text-sm rounded-md ${filterType === t ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
            {t ? TYPE_LABELS[t] : "全部"}
          </button>
        ))}
      </div>
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={() => setShowForm(false)}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-card p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-4">{editingId ? "编辑分类" : "新增分类"}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input type="text" placeholder="分类名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" required />
              <select disabled={Boolean(editingId)} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border rounded text-sm disabled:bg-muted">
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
              {editingId && <p className="text-xs text-muted-foreground">已有分类不能改变收支类型。修改名称会同步更新历史记录中的显示名称。</p>}
              <input type="text" placeholder="图标（emoji）" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              <div className="flex items-center gap-2">
                <label className="text-sm">颜色</label>
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-8 border rounded cursor-pointer" />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">取消</button>
                <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left py-3 px-4">图标</th>
            <th className="text-left py-3 px-4">名称</th>
            <th className="text-left py-3 px-4">类型</th>
            <th className="text-left py-3 px-4">颜色</th>
            <th className="text-left py-3 px-4">状态</th>
            <th className="text-right py-3 px-4">操作</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">加载中...</td></tr>
            ) : categories.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无分类</td></tr>
            ) : categories.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 px-4 text-lg">{c.icon || "-"}</td>
                <td className="py-2 px-4 font-medium">{c.name}{!c.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">（已归档）</span>}</td>
                <td className="py-2 px-4"><span className={`px-2 py-0.5 rounded text-xs ${c.type === "expense" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{TYPE_LABELS[c.type]}</span></td>
                <td className="py-2 px-4">{c.color ? <span className="inline-block w-5 h-5 rounded" style={{ backgroundColor: c.color }} /> : "-"}</td>
                <td className="py-2 px-4">
                  <span className={`inline-flex rounded px-2 py-0.5 text-xs ${c.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {c.isActive ? "生效中" : "已归档"}
                  </span>
                </td>
                <td className="py-2 px-4 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => handleEdit(c)} title="编辑" className="p-1 hover:text-primary"><Edit2 className="h-4 w-4" /></button>
                    <button
                      onClick={() => toggleActive(c)}
                      title={c.isActive ? "归档" : "恢复"}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
                    >
                      {c.isActive ? <><Archive className="h-3.5 w-3.5" /> 归档</> : <><RotateCcw className="h-3.5 w-3.5" /> 恢复</>}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
