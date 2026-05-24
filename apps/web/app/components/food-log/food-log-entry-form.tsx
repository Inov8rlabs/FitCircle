'use client';

import { Loader2, ArrowLeft, X, ImagePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { BeverageLogService } from '@/lib/services/beverage-log-service';
import { FoodLogService } from '@/lib/services/food-log-service';
import { supabase } from '@/lib/supabase';
import type { BeverageCustomizations } from '@/lib/types/beverage-log';

import { BeverageTypeCard } from './beverage-type-card';
import { CategoryCard, type CategoryId } from './category-card';
import { NutritionPreview } from './nutrition-preview';
import { WaterPresetButton } from './water-preset-button';

// Local beverage type catalog. Alcohol entries are deliberately listed here
// so the user can pick a starter type — brand/name/ABV are still editable
// in the alcohol-specific fields below.
const BEVERAGE_TYPES: Record<string, { id: string; name: string; calories: number; caffeine: number }[]> = {
  coffee: [
    { id: 'drip', name: 'Drip Coffee', calories: 2, caffeine: 95 },
    { id: 'espresso', name: 'Espresso', calories: 1, caffeine: 63 },
    { id: 'americano', name: 'Americano', calories: 2, caffeine: 63 },
    { id: 'latte', name: 'Latte', calories: 190, caffeine: 63 },
    { id: 'cappuccino', name: 'Cappuccino', calories: 120, caffeine: 63 },
  ],
  tea: [
    { id: 'black', name: 'Black Tea', calories: 2, caffeine: 47 },
    { id: 'green', name: 'Green Tea', calories: 2, caffeine: 28 },
    { id: 'herbal', name: 'Herbal Tea', calories: 0, caffeine: 0 },
    { id: 'matcha', name: 'Matcha Latte', calories: 240, caffeine: 80 },
  ],
  soda: [
    { id: 'cola', name: 'Cola', calories: 140, caffeine: 34 },
    { id: 'diet_cola', name: 'Diet Cola', calories: 0, caffeine: 46 },
    { id: 'lemon_lime', name: 'Lemon Lime', calories: 140, caffeine: 0 },
  ],
  alcohol: [
    { id: 'beer', name: 'Beer', calories: 153, caffeine: 0 },
    { id: 'light_beer', name: 'Light Beer', calories: 103, caffeine: 0 },
    { id: 'ipa', name: 'IPA', calories: 200, caffeine: 0 },
    { id: 'wine_red', name: 'Red Wine', calories: 125, caffeine: 0 },
    { id: 'wine_white', name: 'White Wine', calories: 120, caffeine: 0 },
    { id: 'spirit', name: 'Spirit (1.5 oz)', calories: 97, caffeine: 0 },
    { id: 'cocktail', name: 'Cocktail', calories: 220, caffeine: 0 },
  ],
};

type AlcoholType = 'beer' | 'wine' | 'spirit' | 'cocktail' | 'other';

const MAX_FOOD_PHOTOS = 5;

/** YYYY-MM-DDTHH:mm in the user's local timezone (datetime-local input format). */
function toLocalDateTimeInputValue(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FoodLogEntryForm() {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const beveragePhotoRef = useRef<HTMLInputElement | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [category, setCategory] = useState<CategoryId>('meal');
  const [notes, setNotes] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);

  // Meal time — the time the user actually ate/drank. Drives the per-day
  // chronological sort (breakfast → lunch → dinner). Defaults to "now".
  const [loggedAt, setLoggedAt] = useState<string>(() => toLocalDateTimeInputValue(new Date()));

  // Meal State
  const [mealType, setMealType] = useState('breakfast');

  // Photos for food entries (meal/snack). Up to MAX_FOOD_PHOTOS.
  const [photos, setPhotos] = useState<File[]>([]);
  const photoPreviews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => {
    return () => photoPreviews.forEach((u) => URL.revokeObjectURL(u));
  }, [photoPreviews]);

  // Water State
  const [waterAmount, setWaterAmount] = useState<number>(0);

  // Beverage State
  const [selectedBevType, setSelectedBevType] = useState<{ id: string; name: string; calories: number; caffeine: number } | null>(null);
  const [customizations, setCustomizations] = useState<BeverageCustomizations>({});
  const [nutrition, setNutrition] = useState({ calories: 0, caffeine: 0, sugar: 0, volume: 240 });

  // Alcohol-specific
  const [alcoholType, setAlcoholType] = useState<AlcoholType | undefined>(undefined);
  const [brand, setBrand] = useState('');
  const [drinkName, setDrinkName] = useState('');
  const [abvPercent, setAbvPercent] = useState<string>('');
  const [servingCount, setServingCount] = useState<string>('1');
  const [beveragePhoto, setBeveragePhoto] = useState<File | null>(null);
  const beveragePhotoPreview = useMemo(
    () => (beveragePhoto ? URL.createObjectURL(beveragePhoto) : null),
    [beveragePhoto]
  );
  useEffect(() => {
    return () => {
      if (beveragePhotoPreview) URL.revokeObjectURL(beveragePhotoPreview);
    };
  }, [beveragePhotoPreview]);

  // Calculate nutrition when beverage selection changes
  useEffect(() => {
    if (selectedBevType) {
      setNutrition({
        calories: selectedBevType.calories,
        caffeine: selectedBevType.caffeine,
        sugar: 0,
        volume: 240,
      });
    }
  }, [selectedBevType, customizations]);

  // Switching category resets fields that don't make sense for the new one.
  useEffect(() => {
    setSelectedBevType(null);
    if (category !== 'alcohol') {
      setBeveragePhoto(null);
    }
  }, [category]);

  function handleAddPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPhotos((prev) => {
      const room = MAX_FOOD_PHOTOS - prev.length;
      if (room <= 0) return prev;
      return [...prev, ...Array.from(files).slice(0, room)];
    });
  }

  /// The mobile API routes verify auth via Bearer token. Web sessions live
  /// in a cookie, but the supabase client exposes the access_token, so we
  /// just attach it for image uploads (the same pattern the iOS/Android
  /// apps use).
  async function getAccessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function uploadFoodPhotosBatch(entryId: string) {
    if (photos.length === 0) return;
    const token = await getAccessToken();
    if (!token) return;
    const form = new FormData();
    photos.forEach((file, i) => {
      form.append('images', file, file.name || `food_${Date.now()}_${i}.jpg`);
    });
    const res = await fetch(`/api/mobile/food-log/${entryId}/images/batch`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Don't block on photo failures — entry is already created.
      console.warn('[food-log] batch photo upload failed', await res.text());
    }
  }

  async function uploadBeveragePhoto(beverageId: string) {
    if (!beveragePhoto) return;
    const token = await getAccessToken();
    if (!token) return;
    const form = new FormData();
    form.append('image', beveragePhoto, beveragePhoto.name || `beverage_${Date.now()}.jpg`);
    const res = await fetch(`/api/mobile/beverages/${beverageId}/images`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn('[beverage-log] photo upload failed', await res.text());
    }
  }

  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Parse the local datetime input back into a real Date.
      const loggedAtISO = new Date(loggedAt).toISOString();
      const entryDate = loggedAt.slice(0, 10); // YYYY-MM-DD

      if (category === 'meal' || category === 'snack') {
        const { data, error } = await FoodLogService.createEntry(user.id, {
          entry_type: 'food',
          meal_type: category === 'snack' ? 'snack' : (mealType as any),
          title: category === 'snack' ? 'Snack' : 'Meal',
          notes,
          is_private: isPrivate,
          logged_at: loggedAtISO,
          entry_date: entryDate,
        }, supabase as any);
        if (error) throw error;
        if (data?.id) await uploadFoodPhotosBatch(data.id);
      } else if (category === 'water') {
        if (waterAmount <= 0) throw new Error('Please select water amount');
        const { error } = await FoodLogService.createEntry(user.id, {
          entry_type: 'water',
          water_ml: waterAmount,
          notes,
          is_private: isPrivate,
          logged_at: loggedAtISO,
          entry_date: entryDate,
        }, supabase as any);
        if (error) throw error;
      } else {
        // Beverage (coffee/tea/soda/juice/alcohol)
        if (!selectedBevType) throw new Error('Please select a beverage type');

        // Build customizations payload. Alcohol entries fold the structured
        // alcohol fields into the JSONB customizations blob to match the
        // shape documented in migration 051.
        const fullCustomizations: BeverageCustomizations = { ...customizations };
        if (category === 'alcohol') {
          if (alcoholType) fullCustomizations.alcohol_type = alcoholType;
          if (brand.trim()) fullCustomizations.brand = brand.trim();
          if (drinkName.trim()) fullCustomizations.name = drinkName.trim();
          const abv = parseFloat(abvPercent);
          if (!Number.isNaN(abv)) fullCustomizations.abv_percent = abv;
          const count = parseInt(servingCount, 10);
          if (!Number.isNaN(count)) fullCustomizations.serving_count = count;
        }

        const { data, error } = await BeverageLogService.createEntry(user.id, {
          category: category as any,
          beverage_type: selectedBevType.name,
          customizations: fullCustomizations,
          volume_ml: nutrition.volume,
          calories: nutrition.calories,
          caffeine_mg: nutrition.caffeine,
          sugar_g: nutrition.sugar,
          notes,
          is_private: isPrivate,
          logged_at: loggedAtISO,
          entry_date: entryDate,
        }, supabase as any);
        if (error) throw error;
        if (category === 'alcohol' && data?.id) {
          await uploadBeveragePhoto(data.id);
        }
      }

      toast({ title: 'Entry saved!', description: 'Your log has been added.' });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('streak-auto-claimed', { detail: { source: 'food_log' } }));
      }

      router.push('/food-log');
      router.refresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft size={20} />
        </Button>
        <h1 className="text-2xl font-bold">New Entry</h1>
      </div>

      {/* Category Selection */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">What are you logging?</h2>

        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meals</span>
          <div className="grid grid-cols-2 gap-3">
            {(['meal', 'snack'] as CategoryId[]).map((id) => (
              <CategoryCard
                key={id}
                id={id}
                label={id.charAt(0).toUpperCase() + id.slice(1)}
                isSelected={category === id}
                onClick={() => setCategory(id)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Beverages</span>
          <div className="grid grid-cols-3 gap-3">
            {(['water', 'coffee', 'tea', 'soda', 'juice', 'alcohol'] as CategoryId[]).map((id) => (
              <CategoryCard
                key={id}
                id={id}
                label={id.charAt(0).toUpperCase() + id.slice(1)}
                isSelected={category === id}
                onClick={() => setCategory(id)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* When — date + time */}
      <section className="space-y-2">
        <Label htmlFor="logged-at">When</Label>
        <Input
          id="logged-at"
          type="datetime-local"
          value={loggedAt}
          onChange={(e) => setLoggedAt(e.target.value)}
          max={toLocalDateTimeInputValue(new Date())}
        />
        <p className="text-xs text-muted-foreground">
          When you actually ate/drank this — used to order today's entries chronologically.
        </p>
      </section>

      {/* Dynamic Content */}
      <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {category === 'water' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">How much water?</h2>
            <div className="grid grid-cols-3 gap-3">
              <WaterPresetButton title="Half Glass" subtitle="120 ml" value={120} selectedValue={waterAmount} onClick={() => setWaterAmount(120)} />
              <WaterPresetButton title="Glass" subtitle="240 ml" value={240} selectedValue={waterAmount} onClick={() => setWaterAmount(240)} />
              <WaterPresetButton title="Bottle" subtitle="500 ml" value={500} selectedValue={waterAmount} onClick={() => setWaterAmount(500)} />
            </div>
            <div className="pt-2">
              <Label>Custom Amount (ml)</Label>
              <Input
                type="number"
                value={waterAmount || ''}
                onChange={(e) => setWaterAmount(parseInt(e.target.value) || 0)}
                placeholder="Enter amount in ml"
              />
            </div>
          </div>
        )}

        {(category === 'coffee' || category === 'tea' || category === 'soda' || category === 'alcohol') && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Select Type</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(BEVERAGE_TYPES[category] || []).map((type) => (
                <BeverageTypeCard
                  key={type.id}
                  id={type.id}
                  name={type.name}
                  calories={type.calories}
                  caffeine={type.caffeine}
                  isSelected={selectedBevType?.id === type.id}
                  onClick={() => setSelectedBevType(type)}
                />
              ))}
            </div>

            {category === 'alcohol' && selectedBevType && (
              <div className="space-y-4 pt-4 border-t">
                <h3 className="text-base font-semibold">Drink details</h3>
                <div>
                  <Label>Type</Label>
                  <div className="grid grid-cols-5 gap-2 mt-2">
                    {(['beer', 'wine', 'spirit', 'cocktail', 'other'] as AlcoholType[]).map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant={alcoholType === t ? 'default' : 'outline'}
                        onClick={() => setAlcoholType(t)}
                        className="capitalize"
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="brand">Brand</Label>
                    <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Stella Artois" />
                  </div>
                  <div>
                    <Label htmlFor="drink-name">Name</Label>
                    <Input id="drink-name" value={drinkName} onChange={(e) => setDrinkName(e.target.value)} placeholder="Old Fashioned" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="abv">ABV %</Label>
                    <Input id="abv" type="number" step="0.1" min="0" max="100"
                      value={abvPercent} onChange={(e) => setAbvPercent(e.target.value)} placeholder="5.0" />
                  </div>
                  <div>
                    <Label htmlFor="serving-count">Servings</Label>
                    <Input id="serving-count" type="number" min="1" max="50"
                      value={servingCount} onChange={(e) => setServingCount(e.target.value)} />
                  </div>
                </div>

                {/* Beverage photo (alcohol only, single) */}
                <div className="space-y-2">
                  <Label>Photo (optional)</Label>
                  {beveragePhoto && beveragePhotoPreview ? (
                    <div className="relative w-40 h-40 rounded-lg overflow-hidden border">
                      <img src={beveragePhotoPreview} alt="Beverage" className="object-cover w-full h-full" />
                      <button
                        type="button"
                        onClick={() => setBeveragePhoto(null)}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => beveragePhotoRef.current?.click()}
                      className="w-40 h-40 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-primary transition"
                    >
                      <ImagePlus size={28} />
                      <span className="text-xs">Add photo</span>
                    </button>
                  )}
                  <input
                    ref={beveragePhotoRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setBeveragePhoto(f);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            )}

            {selectedBevType && category !== 'alcohol' && (
              <div className="space-y-4 pt-4 border-t">
                <h2 className="text-lg font-semibold">Nutrition Preview</h2>
                <NutritionPreview
                  calories={nutrition.calories}
                  caffeineMg={nutrition.caffeine}
                  sugarG={nutrition.sugar}
                  volumeMl={nutrition.volume}
                />
              </div>
            )}
          </div>
        )}

        {(category === 'meal' || category === 'snack') && (
          <div className="space-y-6">
            {category === 'meal' && (
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Meal type</h2>
                <div className="grid grid-cols-3 gap-2">
                  {['breakfast', 'lunch', 'dinner'].map((type) => (
                    <Button
                      key={type}
                      variant={mealType === type ? 'default' : 'outline'}
                      onClick={() => setMealType(type)}
                      className="capitalize"
                    >
                      {type}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Photos */}
            <div className="space-y-2">
              <Label>Photos ({photos.length}/{MAX_FOOD_PHOTOS})</Label>
              <div className="flex flex-wrap gap-3">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative w-32 h-32 rounded-lg overflow-hidden border">
                    <img src={src} alt={`Photo ${i + 1}`} className="object-cover w-full h-full" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
                    >
                      <X size={14} />
                    </button>
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 text-[10px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
                {photos.length < MAX_FOOD_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-32 h-32 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-primary transition"
                  >
                    <ImagePlus size={28} />
                    <span className="text-xs">{photos.length === 0 ? 'Add photos' : 'Add'}</span>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleAddPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Common Fields */}
      <section className="space-y-4 pt-6 border-t">
        <div className="space-y-2">
          <Label>Notes (Optional)</Label>
          <Textarea
            placeholder="Add any details..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
          <div className="space-y-0.5">
            <Label>Private Entry</Label>
            <p className="text-xs text-muted-foreground">Only visible to you</p>
          </div>
          <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
        </div>
      </section>

      <Button
        className="w-full h-12 text-lg"
        onClick={handleSubmit}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
        Save Entry
      </Button>
    </div>
  );
}
