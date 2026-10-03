export const HOME_RECOMMENDATION_LIMIT = 12;

export type HomeRecommendation = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  isPublic: boolean;
};
