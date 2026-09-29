export interface RegenPlanningFields {
  plannedProducts: string[];
  productDetails: Record<string, string>;
  coMeds: Array<{ name: string; dose: string }>;
  assocProcedures: string[];
}

export interface RegenProductPlanningFields {
  plannedProducts: string[];
  productDetails: Record<string, string>;
  coMeds: Array<{ name: string; dose: string }>;
}

export function removeProductFromPlanning(
  { plannedProducts, productDetails, coMeds }: RegenProductPlanningFields,
  productCode: string,
): RegenProductPlanningFields {
  const nextProducts = plannedProducts.filter((code) => code !== productCode);
  const nextDetails = Object.fromEntries(
    Object.entries(productDetails).filter(
      ([key]) => !key.startsWith(`${productCode}__`),
    ),
  );

  return {
    plannedProducts: nextProducts,
    productDetails: nextProducts.length > 0 ? nextDetails : {},
    coMeds: nextProducts.length > 0 ? coMeds : [],
  };
}

/**
 * Planning fields must always be sent in a case PATCH. Omitting them means
 * "leave unchanged" to the API, whereas an empty collection means "clear it".
 */
export function getRegenPlanningPayload({
  plannedProducts,
  productDetails,
  coMeds,
  assocProcedures,
}: RegenPlanningFields): RegenPlanningFields {
  return {
    plannedProducts,
    productDetails,
    coMeds,
    assocProcedures,
  };
}