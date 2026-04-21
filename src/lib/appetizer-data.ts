export type AppetizerDish = {
  name: string;
  surcharge?: number;
};

export type AppetizerSection = {
  label: string;
  frenchLabel: string;
  dishes: readonly AppetizerDish[];
};

export const APPETIZER_INTRO =
  "ジョワ・サンキャトルコースの前菜として、お好みの一品をお選びいただけます。";

export const APPETIZER_SURCHARGE_NOTE =
  "＊ 追加料金表示のある料理は別途料金が発生します（税別）";

export const appetizerSections: readonly AppetizerSection[] = [
  {
    label: "冷製前菜",
    frenchLabel: "Froid",
    dishes: [
      { name: "鰯のマリネ南蛮風　１０年バルサミコ" },
      { name: "パテドカンパーニュ　カナール　ド　パテ" },
      { name: "日向鶏と鴨とフォアグラのガランティーヌ" },
    ],
  },
  {
    label: "温製前菜",
    frenchLabel: "Chaud",
    dishes: [
      { name: "自家製ベーコンとゴルゴンゾーラのキッシュ" },
      { name: "豚タンのコンフィ　粒マスタードオニオンソース", surcharge: 500 },
      { name: "フォアグラのオムレツ　デミグラスソース", surcharge: 800 },
    ],
  },
] as const;
