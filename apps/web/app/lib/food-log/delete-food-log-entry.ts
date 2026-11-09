/** Client-safe: delete a food or water entry through the web API route (cookie session). */
export async function deleteFoodLogEntry(id: string): Promise<void> {
  const res = await fetch(`/api/food-log/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
