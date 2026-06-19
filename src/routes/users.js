const { Router } = require('express');
const { query } = require('express-validator');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const userController = require('../controllers/userController');

const router = Router();

router.get(
  '/search',
  auth,
  [query('q').isLength({ min: 2 }).withMessage('Query must be at least 2 characters'), validate],
  userController.searchUsers
);

router.get('/:userId', auth, userController.getUserById);

module.exports = router;