const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const boardController = require('../controllers/boardController');

const router = Router();

router.get('/', auth, boardController.listBoards);
router.post(
  '/',
  auth,
  [body('title').optional().trim().isLength({ max: 100 }), validate],
  boardController.createBoard
);
router.get('/join/:inviteToken', auth, boardController.joinByInvite);
router.get('/:id', auth, boardController.getBoard);
router.put('/:id', auth, boardController.updateBoard);
router.delete('/:id', auth, boardController.deleteBoard);
router.post('/:id/save-as-template', auth, boardController.saveAsTemplate);
router.post('/:id/invite', auth, boardController.regenerateInviteToken);
router.post('/:id/collaborators', auth, boardController.addCollaborator);
router.delete('/:id/collaborators/:userId', auth, boardController.removeCollaborator);

module.exports = router;