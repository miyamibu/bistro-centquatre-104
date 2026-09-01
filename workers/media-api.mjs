export default {
  fetch() {
    return Response.json(
      { error: "PDF変換は本番環境では無効です", code: "PDF_CONVERSION_DISABLED_IN_PRODUCTION" },
      { status: 410 },
    );
  },
};
