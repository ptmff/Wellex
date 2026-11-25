import { z, ZodError } from 'zod';
import {
  AppError, ErrorCode, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError,
  InsufficientBalanceError, SlippageExceededError, errorHandler,
} from '../../src/common/errors';
import { logger } from '../../src/common/logger';

beforeAll(() => {
  jest.spyOn(logger, 'error').mockImplementation(() => logger);
});

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const req: any = { id: 'req-1', url: '/x', method: 'GET' };

describe('common/errors', () => {
  it('error classes carry code and HTTP status', () => {
    expect(new ValidationError('bad')).toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(new NotFoundError('Market', 'm1')).toMatchObject({ code: ErrorCode.NOT_FOUND, statusCode: 404, message: "Market with id 'm1' not found" });
    expect(new UnauthorizedError()).toMatchObject({ code: ErrorCode.UNAUTHORIZED, statusCode: 401 });
    expect(new ForbiddenError()).toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
    expect(new ConflictError('dup')).toMatchObject({ code: ErrorCode.CONFLICT, statusCode: 409 });
    const ib = new InsufficientBalanceError(5, 6.03);
    expect(ib).toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE, statusCode: 400 });
    const se = new SlippageExceededError(0.5, 0.56, 5);
    expect(se.code).toBe(ErrorCode.SLIPPAGE_EXCEEDED);
    expect(se).toBeInstanceOf(AppError);
  });

  it('errorHandler: ZodError -> 422 with field details', () => {
    let zerr: ZodError | undefined;
    try { z.object({ price: z.number().lt(1) }).parse({ price: 2 }); } catch (e) { zerr = e as ZodError; }
    const res = mockRes();
    errorHandler(zerr!, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].field).toBe('price');
    expect(body.error.requestId).toBe('req-1');
  });

  it('errorHandler: AppError keeps its status/code; PG unique violation -> 409; FK violation -> 400; unknown -> 500', () => {
    let res = mockRes();
    errorHandler(new AppError(ErrorCode.MARKET_CLOSED, 'closed', 400), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('MARKET_CLOSED');

    res = mockRes();
    errorHandler(Object.assign(new Error('dup'), { code: '23505' }), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);

    res = mockRes();
    errorHandler(Object.assign(new Error('fk'), { code: '23503' }), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);

    res = mockRes();
    errorHandler(new Error('boom'), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'boom' }); // non-production shows message

    res = mockRes();
    errorHandler(new AppError(ErrorCode.INTERNAL_ERROR, 'svc down', 503), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
